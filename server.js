const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const os = require('os');
const fs = require('fs');
const QRCode = require('qrcode');
const { validateNumber, validateNumericRecord } = require('./validators');
const registerGmRoutes = require('./routes/gm');
const registerPlayerRoutes = require('./routes/player');
const registerGameplayRoutes = require('./routes/gameplay');

const app = express();
const PORT = process.env.PORT || 5000;
const SAVE_DEBOUNCE_MS = 500;
const PERIODIC_SAVE_MS = Number(process.env.PERIODIC_SAVE_MS || 60000);
const SAVE_BACKUP_LIMIT = Number(process.env.SAVE_BACKUP_LIMIT || 20);
const GAME_STATE_VERSION = 6; // Increment when schema changes
const DISABLE_INDEXING = process.env.DISABLE_INDEXING !== 'false';
const BLOCK_KNOWN_CRAWLERS = process.env.BLOCK_KNOWN_CRAWLERS !== 'false';
const BLOCKED_CRAWLER_UAS = String(process.env.BLOCKED_CRAWLER_UAS || 'googlebot,bingbot,yandexbot,baiduspider,duckduckbot,slurp,sogou,exabot,facebot,ia_archiver')
    .split(',')
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'game_state';
const SUPABASE_STATE_ID = 'primary';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

function canWriteToDir(dirPath) {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
        const probeFile = path.join(dirPath, '.write-test');
        fs.writeFileSync(probeFile, 'ok', 'utf8');
        fs.unlinkSync(probeFile);
        return true;
    } catch {
        return false;
    }
}

function resolveDataDirectory() {
    const candidateDirs = [
        process.env.DATA_VOLUME_PATH,
        process.env.RENDER_DISK_PATH,
        path.join(__dirname, 'data'),
        __dirname,
        os.tmpdir()
    ].filter(Boolean);

    for (const candidate of candidateDirs) {
        if (canWriteToDir(candidate)) {
            return candidate;
        }
    }

    throw new Error('No writable data directory available for save files.');
}

const DATA_DIR = resolveDataDirectory();
const SAVE_FILE_PATH = path.join(DATA_DIR, 'game-state.json');
const BACKUP_DIR = path.join(DATA_DIR, 'save-backups');

let saveTimeout = null;
let periodicSaveTimer = null;
let hasUnsavedChanges = false;
let lastSavedAt = null;
let saveInFlight = false;
let saveQueued = false;

app.use(cors());
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

const apiRateLimitWindowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60000);
const apiRateLimitMax = Number(process.env.API_RATE_LIMIT_MAX || 3000);
app.use('/api', rateLimit({
    windowMs: Number.isFinite(apiRateLimitWindowMs) ? apiRateLimitWindowMs : 60000,
    max: Number.isFinite(apiRateLimitMax) ? apiRateLimitMax : 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' }
}));

app.use(express.json({ limit: '100kb' }));

app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    if (DISABLE_INDEXING) {
        return res.send('User-agent: *\nDisallow: /\n');
    }
    return res.send('User-agent: *\nAllow: /\n');
});

if (DISABLE_INDEXING) {
    app.use((req, res, next) => {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
        next();
    });
}

if (BLOCK_KNOWN_CRAWLERS && BLOCKED_CRAWLER_UAS.length > 0) {
    app.use((req, res, next) => {
        if (req.path === '/robots.txt') {
            return next();
        }

        const userAgent = String(req.headers['user-agent'] || '').toLowerCase();
        const isBlockedCrawler = BLOCKED_CRAWLER_UAS.some((token) => userAgent.includes(token));
        if (isBlockedCrawler) {
            return res.status(403).json({ error: 'Crawler access denied' });
        }
        return next();
    });
}

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'gm-dashboard.html'));
});

app.get('/healthz', async (req, res) => {
    const status = await getStorageStatus();
    const statusCode = status.ok ? 200 : 503;
    res.status(statusCode).json({
        ok: status.ok,
        storageMode: status.storageMode,
        supabaseEnabled: status.supabaseEnabled,
        supabaseTable: status.supabaseTable,
        providerHealthy: status.providerHealthy,
        providerMessage: status.providerMessage,
        lastSavedAt: status.lastSavedAt,
        hasUnsavedChanges: status.hasUnsavedChanges,
        dataDir: DATA_DIR,
        saveFile: SAVE_FILE_PATH,
        backupDir: BACKUP_DIR
    });
});

async function getStorageStatus() {
    const baseStatus = {
        storageMode: SUPABASE_ENABLED ? 'supabase' : 'filesystem',
        supabaseEnabled: SUPABASE_ENABLED,
        supabaseUrlConfigured: Boolean(SUPABASE_URL),
        supabaseKeyConfigured: Boolean(SUPABASE_SERVICE_ROLE_KEY),
        supabaseTable: SUPABASE_TABLE,
        saveFile: SAVE_FILE_PATH,
        lastSavedAt,
        hasUnsavedChanges
    };

    if (!SUPABASE_ENABLED) {
        return {
            ok: true,
            ...baseStatus,
            providerHealthy: true,
            providerMessage: 'Filesystem fallback active'
        };
    }

    try {
        const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=id&limit=1`;
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            }
        });

        if (!response.ok) {
            const body = await response.text();
            return {
                ok: false,
                ...baseStatus,
                providerHealthy: false,
                providerMessage: `Supabase check failed (${response.status})`,
                providerError: body
            };
        }

        return {
            ok: true,
            ...baseStatus,
            providerHealthy: true,
            providerMessage: 'Supabase reachable'
        };
    } catch (error) {
        return {
            ok: false,
            ...baseStatus,
            providerHealthy: false,
            providerMessage: 'Supabase unreachable',
            providerError: error.message
        };
    }
}

// Game state with version tracking for migration
const BASE_GAME_STATE = {
    version: GAME_STATE_VERSION,
    players: {
        logan: {
            name: 'Logan',
            level: 1,
            xp: 0,
            hp: 10,
            maxHp: 10,
            maxRads: 10,
            rads: 0,
            tabs: 10,
            stats: { charm: 1, hardiness: 1, agility: 1, perception: 1, politeness: 1, yarns: 1 },
            scrap: { maritimeMetal: 0, syntheticSap: 0, hubCircuitry: 0, plaidScraps: 0, propaneTank: 0, radMeat: 0, spices: 0, cleanWater: 0 },
            inventory: [],
            activeQuests: [],
            completedQuests: [],
            activeRadio: null,
            activeRadioData: null,
            faction: null,
            class: null,
            unlockedPerks: [],
            pendingPerks: 0,
            craftedGear: [],
            purchasedUpgrades: [],
            activeEffects: [],
            educationalCompleted: [],
            educationalBoard: null
        },
        rylyn: {
            name: 'Rylyn',
            level: 1,
            xp: 0,
            hp: 10,
            maxHp: 10,
            maxRads: 10,
            rads: 0,
            tabs: 10,
            stats: { charm: 1, hardiness: 1, agility: 1, perception: 1, politeness: 1, yarns: 1 },
            scrap: { maritimeMetal: 0, syntheticSap: 0, hubCircuitry: 0, plaidScraps: 0, propaneTank: 0, radMeat: 0, spices: 0, cleanWater: 0 },
            inventory: [],
            activeQuests: [],
            completedQuests: [],
            activeRadio: null,
            activeRadioData: null,
            faction: null,
            class: null,
            unlockedPerks: [],
            pendingPerks: 0,
            craftedGear: [],
            purchasedUpgrades: [],
            activeEffects: [],
            educationalCompleted: [],
            educationalBoard: null
        }
    },
    perks: [
        { id: 'p1', name: "IRON CALVES", desc: "Climbing Jacob's Ladder no longer causes HP loss.", tier: 1 },
        { id: 'p2', name: "AQUA-BLUENOSER", desc: "Immune to Radiation while at the shoreline.", tier: 1 },
        { id: 'p3', name: "THRIFTY TOWNIE", desc: "Gain 2 extra Pop Tabs from every quest.", tier: 2 },
        { id: 'p4', name: "DONAIR DIGESTION", desc: "Healing items (snacks) restore double HP.", tier: 1 },
        { id: 'p5', name: "SCRAPPER", desc: "50% chance to find double scrap items.", tier: 2 },
        { id: 'p6', name: "LEAD BELLY", desc: "Eating 'Red Mud' food causes 0 Radiation. Also grants +2 Max RADS.", tier: 1, maxRadsBonus: 2 },
        { id: 'p7', name: "WASTELAND WAND", desc: "+1 Agility on trails and outdoor areas.", tier: 2 },
        { id: 'p8', name: "SCAVENGER'S EYE", desc: "+1 Perception for finding hidden items.", tier: 3 },
        { id: 'p9', name: "PLAID PRIDE", desc: "+2 Charisma with faction members.", tier: 2 },
        { id: 'p10', name: "QUICK-HANDS", desc: "+10% attack speed with melee weapons.", tier: 3 },
        { id: 'p11', name: "TIDAL MASTER", desc: "Predict Tidal Bore patterns; cross safely at any time.", tier: 2 },
        { id: 'p12', name: "FOG WALKER", desc: "Move freely through radioactive fog without vision penalty.", tier: 3 },
        { id: 'p13', name: "COVE CLIMBER", desc: "Scaling any cliff or rock formation grants +1 to next action.", tier: 2 },
        { id: 'p14', name: "KITCHEN PARTY", desc: "Social encounters grant +15% charm and +10% tabs reward.", tier: 1 },
        { id: 'p15', name: "LOBSTER REFLEXES", desc: "Dodge incoming damage with +2 to agility checks.", tier: 3 },
        { id: 'p16', name: "HIGHLAND HARDNESS", desc: "+3 Max HP. You're built for the brutal Nova Scotia terrain.", tier: 2, maxHpBonus: 3 },
        { id: 'p17', name: "RADIO TUNER", desc: "Unlock 3 additional radio signals beyond normal broadcasts.", tier: 1 },
        { id: 'p18', name: "DONAIR CHARM", desc: "Class perk: +1 Charm and a gift for smooth-talking your way through the wasteland.", tier: 1 },
        { id: 'p19', name: "TIDEWALL STANCE", desc: "Class perk: +1 Hardiness and steady footing when things get splashy.", tier: 1 },
        { id: 'p20', name: "FOGLINE FOCUS", desc: "Class perk: +1 Perception for spotting clues in the mist.", tier: 1 },
        { id: 'p21', name: "SCRAP SNATCH", desc: "Class perk: +1 Agility for quick, careful salvage runs.", tier: 1 }
    ],
    statusEffects: [
        {
            id: 'se1',
            name: "DONAIR SWEATS",
            desc: "You smell so strongly of garlic and spiced beef that you can't sneak, and people don't want to talk to you.",
            trigger: "Consuming low-quality Mystery Meat",
            type: 'debuff',
            effects: { agility: -1, politeness: -1 },
            modifiers: { hpLossBonus: 1, missionTabsBonus: -1 },
            recovery: "Drink clean water or wait 30 minutes",
            durationMinutes: 30
        },
        {
            id: 'se2',
            name: "FOG-BRAIN",
            desc: "Your vision is obscured by a thick, glowing pea-soup fog. You might be walking toward a cliff or a Tim Hortons; you can't tell.",
            trigger: "Spending too long in the irradiated coastal mist",
            type: 'debuff',
            effects: { perception: -2 },
            modifiers: {
                radioVerifyDcBonus: 2,
                radGainBonus: 1,
                statCheckBonus: { perception: -2 }
            },
            recovery: "Find a campfire or high ground",
            durationMinutes: null
        },
        {
            id: 'se3',
            name: "KITCHEN PARTY HYPE",
            desc: "A surge of local pride makes you feel invincible and incredibly talkative.",
            trigger: "Hearing a fiddle tune or successfully telling a Yarn",
            type: 'buff',
            effects: { charm: 2, hardiness: 1 },
            modifiers: {
                missionTabsPercent: 0.15,
                healingBonusFlat: 1,
                statCheckBonus: { charm: 2, politeness: 1, yarns: 1 }
            },
            durationMinutes: 15
        },
        {
            id: 'se4',
            name: "BLACK ROCK SLIP",
            desc: "You didn't stay off the black rocks at Peggy's Cove. The Atlantic Ocean humbled you.",
            trigger: "Rolling a 1 near the coastline",
            type: 'debuff',
            effects: { hp: -3, hardiness: -1 },
            modifiers: { hpLossBonus: 1, radGainBonus: 1 },
            permanent: true
        },
        {
            id: 'se5',
            name: "OVER-POLITE STANDOFF",
            desc: "A classic Nova Scotian deadlock where nobody wants to be the one to go first.",
            trigger: "Encountering another player at a doorway or loot pile",
            type: 'mutual_debuff',
            effects: { skipNextTurn: true },
            modifiers: { missionTabsBonus: -2, missionXpBonus: -1 },
            durationTurns: 1
        },
        {
            id: 'se6',
            name: "BATTLE RHYTHM",
            desc: "You lock into the beat of the wasteland. Momentum carries your actions.",
            trigger: "Winning a high-roll encounter",
            type: 'buff',
            effects: { agility: 1, hardiness: 1 },
            modifiers: {
                hpLossReduction: 1,
                missionTabsBonus: 2,
                scrapRewardBonus: 1,
                statCheckBonus: { agility: 1 }
            },
            durationMinutes: 20
        },
        {
            id: 'se7',
            name: "COASTAL SHIELD",
            desc: "A salty wind hardens your resolve against radioactive drizzle.",
            trigger: "Using shoreline cover effectively",
            type: 'buff',
            effects: { hardiness: 1 },
            modifiers: {
                radGainReduction: 2,
                hpLossReduction: 1
            },
            durationMinutes: 25
        },
        {
            id: 'se8',
            name: "SCRAP FEVER",
            desc: "Your eyes light up at every rusted corner; everything looks salvageable.",
            trigger: "After a successful salvage chain",
            type: 'buff',
            effects: { perception: 1, agility: 1 },
            modifiers: {
                scrapRewardBonus: 1,
                tabsGainBonus: 1,
                missionTabsPercent: 0.10
            },
            durationMinutes: 20
        },
        {
            id: 'se9',
            name: "RAD SICKNESS",
            desc: "The glow gets in your lungs. Actions feel slower and sloppier.",
            trigger: "Failing radiation safety checks",
            type: 'debuff',
            effects: { agility: -1, perception: -1 },
            modifiers: {
                radGainBonus: 1,
                hpLossBonus: 1,
                healingPenaltyFlat: 1,
                missionTabsBonus: -2
            },
            durationMinutes: 30
        },
        {
            id: 'se10',
            name: "VAULT FOCUS",
            desc: "You steady your breathing and execute tasks with clean precision.",
            trigger: "Completing two educational tasks in a row",
            type: 'buff',
            effects: { perception: 1, politeness: 1 },
            modifiers: {
                missionXpBonus: 1,
                missionTabsBonus: 1,
                statCheckBonus: { perception: 1, yarns: 1 }
            },
            durationMinutes: 20
        }
    ],
    quests: [
        { id: 'h1', title: "VAULT: Sanitize Quarters", desc: "Set a 10-minute timer. Put toys in bins, books on shelves, and dirty clothes in the hamper. Show the floor is clear.", category: 'vault', rewardTabs: 3, rewardScrap: { syntheticSap: 1 }, xp: 0 },
        { id: 'h2', title: "VAULT: Nutrient Synthesis", desc: "Help with one meal job: wash produce, set the table, or stir with an adult. Finish your job and report back.", category: 'vault', rewardTabs: 4, rewardScrap: { cleanWater: 1, spices: 1 }, xp: 1 },
        { id: 'h3', title: "VAULT: Static Discharge", desc: "Fold 8 pieces of clean laundry (or one small basket) and place them in the correct room or drawer.", category: 'vault', rewardTabs: 3, rewardScrap: { plaidScraps: 1 }, xp: 0 },
        { id: 'q2', title: "The Great Drain", desc: "Take a 15-minute outdoor walk with an adult. Find 3 cool nature things (rock, leaf, stick) and describe them.", category: 'main', rewardTabs: 8, rewardScrap: { maritimeMetal: 2 }, xp: 1 },
        { id: 'q5', title: "Jacob's Ladder Trial", desc: "Do a safe stair or movement challenge: 5 up-and-down stair trips or 30 step-ups. Go slow and keep good balance.", category: 'main', rewardTabs: 14, rewardScrap: { hubCircuitry: 1 }, xp: 1 },
        { id: 'q6', title: "Witches' Cauldron Mystery", desc: "Complete a water mission: fill water bottles for the family and wipe one counter or table area.", category: 'main', rewardTabs: 14, rewardScrap: { radMeat: 1, cleanWater: 1 }, xp: 1 },
        { id: 'q11', title: "Battle for the Bazaar", desc: "Do a teamwork clean-up in a shared room for 15 minutes. Pick up, sort, and put away items in the right spots.", category: 'main', rewardTabs: 28, rewardScrap: { maritimeMetal: 2, hubCircuitry: 2 }, xp: 2 },
        { id: 'q12', title: "The Tidal Bore Race", desc: "Before a 5-minute timer ends, collect 10 scattered items and return them to their homes.", category: 'side', rewardTabs: 12, rewardScrap: { maritimeMetal: 1, syntheticSap: 1 }, xp: 1 },
        { id: 'q13', title: "The Plaid Patch-Up", desc: "Find 3 things out of place in your room and fix them. Then make your bed so it looks mission-ready.", category: 'side', rewardTabs: 9, rewardScrap: { plaidScraps: 2, syntheticSap: 1 }, xp: 1 },
        { id: 'q14', title: "Three-Crows Signal Boost", desc: "Two-player mission: one player holds a balance pose for 30 seconds while the other reads a short message clearly.", category: 'side', rewardTabs: 6, rewardScrap: { hubCircuitry: 1 }, xp: 0 },
        { id: 'q15', title: "The Junk-Jet Prototype", desc: "Collect 5 safe recycle items (paper/plastic/cardboard). Tell what each could become in a new invention.", category: 'side', rewardTabs: 15, rewardScrap: { propaneTank: 1, maritimeMetal: 1 }, xp: 1 },
        { id: 'q16', title: "Five Islands Provincial Park (The Great Drain)", desc: "Do an outdoor obstacle mission with an adult: hop, walk, and climb safely for 10 minutes without quitting.", category: 'main', rewardTabs: 16, rewardScrap: { maritimeMetal: 2, cleanWater: 1 }, xp: 1 },
        { id: 'q17', title: "Shubenacadie Wildlife Park (The Beast Pens)", desc: "Spot and name 3 animals (outside, in books, or in a video). Share one fact about each animal.", category: 'main', rewardTabs: 15, rewardScrap: { radMeat: 1, spices: 1 }, xp: 1 },
        { id: 'h4', title: "VAULT: Supply Check", desc: "Check your school bag: put in homework folder, water bottle, and one reading book. Show it is ready.", category: 'vault', rewardTabs: 3, rewardScrap: { hubCircuitry: 1 }, xp: 0 },
        { id: 'h5', title: "VAULT: Snack Station", desc: "Help prepare a healthy snack plate with an adult and clean the prep area after.", category: 'vault', rewardTabs: 4, rewardScrap: { spices: 1 }, xp: 0 },
        { id: 'q18', title: "Harbor Signal Sweep", desc: "Do a 12-minute tidy patrol: clear one room section and sort items into keep, trash, and donate piles.", category: 'main', rewardTabs: 16, rewardScrap: { maritimeMetal: 1, plaidScraps: 1 }, xp: 1 },
        { id: 'q19', title: "Maple Grid Calibration", desc: "Practice learning skills: read for 10 minutes, then tell 3 key facts from what you read.", category: 'main', rewardTabs: 16, rewardScrap: { hubCircuitry: 1, cleanWater: 1 }, xp: 1 },
        { id: 'q20', title: "Lighthouse Relay Run", desc: "Run a relay with an adult: 3 rounds of carry-and-return with safe objects between two spots.", category: 'side', rewardTabs: 10, rewardScrap: { syntheticSap: 1, maritimeMetal: 1 }, xp: 1 },
        { id: 'q21', title: "Moon-Mist Mixer", desc: "Create a simple recipe with help (like fruit and yogurt), then clean up dishes and table.", category: 'side', rewardTabs: 10, rewardScrap: { spices: 1, cleanWater: 1 }, xp: 1 },
        { id: 'q22', title: "Radar Blanket Fort", desc: "Build a small fort with 2 rules: safe walkway and tidy cleanup in under 5 minutes after play.", category: 'side', rewardTabs: 12, rewardScrap: { plaidScraps: 2 }, xp: 1 },
        { id: 'q23', title: "Fogline Fitness Drill", desc: "Complete 3 movement sets: 10 jumps, 10 squats, and 20-second balance hold (repeat 2 times).", category: 'main', rewardTabs: 18, rewardScrap: { propaneTank: 1, syntheticSap: 1 }, xp: 1 },
        { id: 'h6', title: "VAULT: Reactor Sweep", desc: "Run a 10-minute tidy cycle in one room: collect clutter, sort keep/trash, and wipe one shelf or table.", category: 'vault', rewardTabs: 4, rewardScrap: { syntheticSap: 1, plaidScraps: 1 }, xp: 1 },
        { id: 'h7', title: "VAULT: Night Prep Protocol", desc: "Set out tomorrow gear: water bottle, reading book, and homework folder, then sanitize your desk area.", category: 'vault', rewardTabs: 4, rewardScrap: { cleanWater: 1, hubCircuitry: 1 }, xp: 1 },
        { id: 'q24', title: "Pine Ridge Trail Scan", desc: "Take a 15-minute outdoor trail walk with an adult and identify 4 nature clues (leaf, rock, bark, cloud).", category: 'side', rewardTabs: 12, rewardScrap: { maritimeMetal: 1, cleanWater: 1 }, xp: 1 },
        { id: 'q25', title: "Harbor Bluff Path Watch", desc: "Hike a safe park route for 12 minutes, then report two landmarks and one safety check you followed.", category: 'main', rewardTabs: 13, rewardScrap: { maritimeMetal: 1, syntheticSap: 1 }, xp: 1 },
        { id: 'q26', title: "Learning Relay: Reading Report", desc: "Read for 12 minutes, then tell 4 facts and one new word from your book or article.", category: 'main', rewardTabs: 14, rewardScrap: { hubCircuitry: 1, cleanWater: 1 }, xp: 1 },
        { id: 'q27', title: "Map Reading Signal Test", desc: "Complete a map reading challenge: identify north/east/south/west and explain the shortest path between two points.", category: 'side', rewardTabs: 14, rewardScrap: { hubCircuitry: 1, plaidScraps: 1 }, xp: 1 },
        { id: 'q28', title: "Vault Workout: Ladder Burn", desc: "Complete 3 workout rounds: 12 step-ups, 10 squats, and 20-second balance hold with clean form.", category: 'main', rewardTabs: 15, rewardScrap: { propaneTank: 1, syntheticSap: 1 }, xp: 1 },
        { id: 'q29', title: "Vault Workout: Core Circuit", desc: "Do a fitness drill of 3 rounds: 15 marches, 10 jumps, and 10-second plank; rest safely between rounds.", category: 'main', rewardTabs: 15, rewardScrap: { propaneTank: 1, maritimeMetal: 1 }, xp: 1 }
    ],
    randomQuests: [
        { id: 'rq1', title: "HOUSE: Tidy the Living Room", desc: "Put away 10 items from the floor, then fluff pillows and fold one blanket.", reward: 2, xp: 0 },
        { id: 'rq2', title: "HOUSE: Wash the Dishes", desc: "With adult help, wash or dry 8 dishes, then place them where they belong.", reward: 2, xp: 0 },
        { id: 'rq3', title: "HOUSE: Make Your Bed", desc: "Straighten sheets, pull blanket flat, and place pillows neatly in 3 minutes.", reward: 2, xp: 0 },
        { id: 'rq4', title: "HOUSE: Sweep the Kitchen", desc: "Sweep one kitchen area and collect crumbs into the dustpan.", reward: 2, xp: 0 },
        { id: 'rq5', title: "CRAFT: Build a Lego Structure", desc: "Build a model with at least 15 pieces and give it a cool name.", reward: 3, xp: 0 },
        { id: 'rq6', title: "CRAFT: Draw or Paint", desc: "Draw or paint a picture with at least 3 colors and show it to the GM.", reward: 3, xp: 0 },
        { id: 'rq7', title: "CRAFT: Assemble a Model", desc: "Complete one model step-by-step and clean up pieces when finished.", reward: 3, xp: 1 },
        { id: 'rq8', title: "SPORT: Play Soccer in the Yard", desc: "Do 20 kicks or passes and 5 goal shots safely with clear space.", reward: 3, xp: 1 },
        { id: 'rq9', title: "SPORT: Go for a Bike Ride", desc: "Ride for 10 minutes with helmet on and follow adult safety rules.", reward: 4, xp: 1 },
        { id: 'rq10', title: "SPORT: Play Catch", desc: "Complete 20 catches with a partner (or wall tosses) without giving up.", reward: 2, xp: 0 },
        { id: 'rq11', title: "CHORE: Fold Laundry", desc: "Fold 8 clothing items and place them in the correct room.", reward: 2, xp: 0 },
        { id: 'rq12', title: "CHORE: Take Out Trash", desc: "Collect one full bin, tie bag safely, and replace it with a new bag.", reward: 2, xp: 0 },
        { id: 'rq13', title: "CHORE: Organize Closet", desc: "Sort one shelf or drawer: keep, put away, and remove 5 out-of-place items.", reward: 3, xp: 1 },
        { id: 'rq14', title: "HOUSE: Entryway Reset", desc: "Line up shoes, hang coats, and clear backpacks from the floor.", reward: 2, xp: 0 },
        { id: 'rq15', title: "HOUSE: Table Wipe-Down", desc: "Wipe the table and 4 chairs with help, then push chairs in neatly.", reward: 2, xp: 0 },
        { id: 'rq16', title: "CRAFT: Story Comic", desc: "Draw a 3-panel comic about your wasteland hero and read it out loud.", reward: 3, xp: 1 },
        { id: 'rq17', title: "CRAFT: Build-and-Explain", desc: "Build something from blocks and explain what each part does.", reward: 3, xp: 1 },
        { id: 'rq18', title: "SPORT: Mini Obstacle Course", desc: "Complete a safe obstacle course with 5 checkpoints.", reward: 3, xp: 1 },
        { id: 'rq19', title: "SPORT: Stretch Session", desc: "Do 5 stretches and hold each for 15 seconds.", reward: 2, xp: 0 },
        { id: 'rq20', title: "CHORE: Toy Sort", desc: "Sort toys into 3 groups and put each group away in the correct place.", reward: 3, xp: 0 },
        { id: 'rq21', title: "CHORE: Bedside Reset", desc: "Clear your bedside area and place books and water neatly.", reward: 2, xp: 0 },
        { id: 'rq22', title: "LEARNING: Math Sprint", desc: "Solve 10 math questions at your level and check answers with an adult.", reward: 3, xp: 1 }
    ],
    educationalQuests: [],
    radioSignals: [
        { id: 'r1', title: "ENTERING DEBERT", text: "You're treadin' on ancient ground now, scavengers. Debert awaits." },
        { id: 'r2', title: "THE HERMIT'S LAST WORDS", text: "Eyes like burning pitch... it walks the northern woods..." },
        { id: 'r3', title: "DEBERT NUMBERS STATION", text: "[SYNTHESIZED VOICE] Coordinates: North 45.3471 West 63.2851..." },
        { id: 'r4', title: "THE MASTODON'S CALL", text: "[DEAFENING RUMBLE] The Awakening approaches..." },
        { id: 'r5', title: "TIDAL BORE WARNING", text: "ALERT! The Tidal Bore is moving... 5 minutes until the surge. All units retreat to high ground NOW!" },
        { id: 'r6', title: "PLAID PATCH ALERT", text: "Vault integrity compromised. Air-lock seal has failed. Patch required immediately. Plaid Scrap + Synthetic Sap needed." },
        { id: 'r7', title: "SIGNAL BOOST REQUEST", text: "Three-Crows Radio fading... signal weakening. We need a Signal Flare at the Highest Peak. Someone hold the light!" },
        { id: 'r8', title: "JUNK-JET BROADCAST", text: "Prototype testing in progress. Scrap collectors needed. Bring us 5 pieces from different Biomes for analysis." },
        { id: 'r9', title: "GREAT DRAIN LOCATION", text: "Coordinates locked: Five Islands Provincial Park. Beware the Red Mud. The Tidal Rush is unpredictable. Proceed with caution." },
        { id: 'r10', title: "BEAST PENS SIGHTING", text: "Movement detected at Shubenacadie Wildlife Park. Rad-Moose and Yao Guai variants confirmed. Scout teams deploy. Biological data required." },
        { id: 'r11', title: "LIGHTHOUSE FLASH", text: "Lighthouse relay flickering! Perform a movement drill and report stability." },
        { id: 'r12', title: "HARBOR CACHE", text: "Scattered supplies detected in Sector Harbor. Recover and sort the cache." },
        { id: 'r13', title: "CLASSROOM UPLINK", text: "Knowledge uplink open. Read intel and report three facts for mission bonus." },
        { id: 'r14', title: "FORTIFY ORDER", text: "Blanket-fort protocol active. Build, secure, and clean in one clean operation." }
    ],
    broadcastSignals: [
        { id: 'b1', title: "THREE-CROWS RADIO: MUSIC HOUR", text: "[STATIC] Now playing: The Atomic Dream by The Pip-Boys..." },
        { id: 'b2', title: "WEATHER ALERT", text: "ATTENTION: High-pressure rad-front moving in from the northeast. Recommend increasing vault shielding." },
        { id: 'b3', title: "SURVIVOR LOG", text: "[CRACKLING VOICE] This is Overseer Sinclair... Day 847... We endure..." },
        { id: 'b4', title: "STRANGE SIGNAL", text: "[MYSTERIOUS BEEPING] ...cannot identify source... ...repeating pattern..." },
        { id: 'b5', title: "DISTRESS CALL", text: "[GARBLED TRANSMISSION] ...anyone... ...need help... ...coordinates unknown..." },
        { id: 'b6', title: "OLD WORLD BROADCAST", text: "[ANCIENT RECORDING] Welcome to Three-Crows Radio, serving Halifax since 1957..." },
        { id: 'b7', title: "VAULT-TEC ANNIVERSARY", text: "Celebrating another year of safety and security! Vault-Tec: Ensuring your family's future!" },
        { id: 'b8', title: "UNKNOWN TRANSMISSION", text: "[WHISPERED] ...they're coming... ...prepare the defenses... ...the old ones stir..." },
        { id: 'b9', title: "THE BIG STOP BEACON", text: "Greetings traveler! You are 400 miles from the nearest functioning IRVING Big Stop. Today's special is: Rad-Turkey Club and a side of Glow-Slaw. Please have your Tabs ready. Note: We are currently out of napkins." },
        { id: 'b10', title: "MARITIME AUTOMATED WEATHER", text: "Conditions in the Minas Basin: 100% chance of acid rain, followed by a light dusting of nuclear soot. Wind speeds are currently high enough to throw a Rad-Cow into New Brunswick. Have a pleasant day, and stay off the black rocks." },
        { id: 'b11', title: "EMERGENCY BROADCAST (HERITAGE MINUTE EDITION)", text: "I... I can't find a vein! Dramatic piano music plays. This has been a Maritime Heritage Minute. If you find a pre-war medicinal syringe, please return it to the nearest vault." },
        { id: 'b12', title: "THE BRIDGE TOLL BANDIT", text: "This is a public service announcement for anyone crossing the MacKay. The toll is no longer $1.00. It is now your left boot and a roll of duct tape. Don't make me come down from the rafters, I haven't had my coffee yet." },
        { id: 'b13', title: "THE FIDDLE-HEAD RADIO", text: "[Aggressive, high-speed fiddle music plays for 10 seconds] IF YOU CAN HEAR THIS, THE KITCHEN PARTY AT SECTOR 4 IS STILL GOING. WE HAVE THREE GALLONS OF MOON-MIST AND A RADIATED LOBSTER. NO RAIDERS ALLOWED UNLESS YOU CAN PLAY THE SPOONS." },
        { id: 'b14', title: "PROPAGANDA FROM THE VALLEY", text: "Why settle for the salty ruins of Halifax when you can have the mutated orchards of the Annapolis Valley? Our apples are the size of basketballs and only 20% lethal! Join the Apple-Core today!" },
        { id: 'b15', title: "THE GHOST OF THE BLUENOSE", text: "Can you hear the creaking? She's sailing on the fog again... if you see a schooner made of scrap metal and glowing sails near Lunenburg, do not wave. She doesn't want passengers. She wants your Hub Circuitry." },
        { id: 'b16', title: "THE DOUBLE-DOUBLE LOOP", text: "[A distorted, slow-motion voice over heavy static] Large... double... double... large... double... double... screaming... I SAID LARGE DOUBLE DOUBLE." },
        { id: 'b17', title: "THE OAK ISLAND PING", text: "Entry 4,002. We've dug another ten feet. We found a coconut fiber mat and a single pre-war bottle cap. Could this be the treasure? Or just another trap? Heavy sound of water rushing into a tunnel... Not again!" },
        { id: 'b18', title: "SCHOOLBELL STATIC", text: "[CHIME + STATIC] Morning checklist protocol: bags packed, books loaded, mission ready." },
        { id: 'b19', title: "HARBOR WEATHER BURST", text: "Fog lifting for 20 minutes. Ideal window for quick outdoor scouting." },
        { id: 'b20', title: "THE COOKIE TIN CODE", text: "[BEEP] One tidy room. Two clean hands. Three cheers for the crew." },
        { id: 'b21', title: "MARKET OPEN SIGNAL", text: "Masstown market open for 10 minutes. Best rewards for teamwork missions." },
        { id: 'b22', title: "BEDTIME COUNTDOWN", text: "Command reminder: complete final cleanup cycle before lights-out." }
    ],
    questRadioMap: {
        q12: 'r5',
        q13: 'r6',
        q14: 'r7',
        q15: 'r8',
        q16: 'r9',
        q17: 'r10',
        q18: 'r12',
        q19: 'r13',
        q20: 'r11',
        q21: 'r12',
        q22: 'r14',
        q23: 'r11'
    },
    questChains: [
        {
            id: 'chain_tidewatch',
            name: 'TIDEWATCH PROTOCOL',
            questIds: ['q12', 'q13', 'q14'],
            finalReward: {
                tabs: 8,
                xp: 1,
                perkId: 'p17',
                item: 'Tidewatch Signal Decoder'
            }
        },
        {
            id: 'chain_wildfrontier',
            name: 'WILD FRONTIER SWEEP',
            questIds: ['q16', 'q17'],
            finalReward: {
                tabs: 6,
                xp: 1,
                item: 'Park Warden Field Kit'
            }
        },
        {
            id: 'chain_harborline',
            name: 'HARBORLINE RECOVERY',
            questIds: ['q18', 'q20', 'q22'],
            finalReward: {
                tabs: 10,
                xp: 1,
                item: 'Harborline Relay Badge'
            }
        }
    ],
    radioConsequences: {
        trapSignalIds: ['b4', 'b5', 'b8', 'b16'],
        verifyDc: 10,
        failure: {
            hpLoss: 1,
            radsGain: 1
        },
        success: {
            tabsGain: 5
        }
    },
    eventCards: [
        {
            id: 'ev_rad_storm',
            name: 'RAD STORM',
            text: 'A toxic rad storm rolls over the zone. All players take +1 RAD.',
            effect: { rads: 1 }
        },
        {
            id: 'ev_merchant_visit',
            name: 'MERCHANT VISIT',
            text: 'A roaming merchant appears. All players gain +4 Tabs.',
            effect: { tabs: 4 }
        },
        {
            id: 'ev_vault_breach',
            name: 'VAULT BREACH',
            text: 'A vault breach causes injuries. All players lose 1 HP.',
            effect: { hp: -1 }
        },
        {
            id: 'ev_ally_rescue',
            name: 'ALLY RESCUE',
            text: 'A rescued ally shares supplies. All players gain +1 random scrap.',
            effect: { randomScrap: 1 }
        },
        {
            id: 'ev_training_boost',
            name: 'TRAINING BOOST',
            text: 'Training bonus online. All players gain +1 XP from their next mission.',
            effect: { tabs: 5 }
        },
        {
            id: 'ev_supply_drop',
            name: 'SUPPLY DROP',
            text: 'A supply pod lands nearby. All players gain +2 random scrap.',
            effect: { randomScrap: 2 }
        }
    ],
    achievements: [
        {
            id: 'ach_first_craft',
            name: 'FIRST CRAFT',
            desc: 'Craft your first item.',
            reward: { tabs: 2, xp: 1 }
        },
        {
            id: 'ach_quest_runner',
            name: 'QUEST RUNNER',
            desc: 'Complete 10 quests.',
            reward: { tabs: 5, xp: 1 }
        },
        {
            id: 'ach_chappy_master',
            name: 'CHAPPY MASTER',
            desc: 'Reach 8 in any C.H.A.P.P.Y. stat.',
            reward: { tabs: 3, xp: 1 }
        },
        {
            id: 'ach_team_player',
            name: 'TEAM PLAYER',
            desc: 'Contribute to 3 shared team objectives.',
            reward: { tabs: 4, xp: 1 }
        }
    ],
    classPassives: {
        scavenger: {
            id: 'scavenger',
            label: 'SCAVENGER',
            desc: 'Gain +1 random scrap after encounters.'
        },
        vanguard: {
            id: 'vanguard',
            label: 'VANGUARD',
            desc: 'Recover +1 HP after encounter resolve (up to max).' 
        },
        signaler: {
            id: 'signaler',
            label: 'SIGNALER',
            desc: 'Get +2 tabs on successful radio verification.'
        },
        diplomat: {
            id: 'diplomat',
            label: 'DIPLOMAT',
            desc: 'Gain +2 tabs when completing quests.'
        }
    },
    teamObjectives: [
        {
            id: 'team_signal_tower',
            name: 'SIGNAL TOWER STABILIZATION',
            desc: 'Both players each complete one task: one tidy mission and one movement mission, then report done.',
            reward: { tabs: 5, xp: 1 }
        },
        {
            id: 'team_convoy_escort',
            name: 'CONVOY ESCORT',
            desc: 'Work together: one player gathers supplies while the other clears a path. Finish both jobs to complete.',
            reward: { tabs: 6, xp: 1 }
        },
        {
            id: 'team_fog_survey',
            name: 'FOG SURVEY',
            desc: 'Each player explores a different room/area, finds 3 things, and reports findings to the GM.',
            reward: { tabs: 4, xp: 1 }
        },
        {
            id: 'team_home_base_reset',
            name: 'HOME BASE RESET',
            desc: 'One player tidies play zone while the other organizes supplies. Switch and verify both tasks complete.',
            reward: { tabs: 4, xp: 1 }
        },
        {
            id: 'team_story_transmission',
            name: 'STORY TRANSMISSION',
            desc: 'Both players create and share one short mission story with a clear beginning, middle, and end.',
            reward: { tabs: 5, xp: 1 }
        }
    ],
    activeTeamObjective: null,
    sessionMetrics: {
        startedAt: new Date().toISOString(),
        questCompletions: {
            logan: 0,
            rylyn: 0
        },
        scrapGained: {
            logan: 0,
            rylyn: 0
        },
        funniestRadio: null,
        lastRecap: null
    },
    playerProgress: {
        logan: {
            achievements: [],
            chainProgress: {},
            passiveKey: null
        },
        rylyn: {
            achievements: [],
            chainProgress: {},
            passiveKey: null
        }
    },
    randomEncounters: [
        {
            id: 'e1',
            title: 'RAD-MOOSE SIGHTING',
            text: 'WARNING: A glowing Rad-Moose has been spotted near your sector. Keep your distance or prepare for a fight.'
        },
        {
            id: 'e2',
            title: 'HIGHWAY 104 AMBUSH',
            text: 'ALERT: Raiders have set up a scrap-metal barricade. They are demanding 5 Tabs for safe passage.'
        },
        {
            id: 'e3',
            title: 'FERAL GHOUL PACK',
            text: 'RADIO STATIC: ...they are coming out of the basement! Feral pack moving fast through the ruins!'
        },
        {
            id: 'e4',
            title: 'ABANDONED SLOCUMS JOE',
            text: 'LUCK: You have found a preserved Slocums Joe. It is dusty, but there might be some useful scrap or a snack inside.'
        },
        {
            id: 'e5',
            title: 'CRASHED VERTIBIRD',
            text: 'SIGNAL: Emergency beacon detected. A Pre-War transport has crashed nearby. High chance of finding Steel and Circuits.'
        },
        {
            id: 'e6',
            title: 'TRAVELING MERCHANT',
            text: "TRADER: 'Hey there! Name is Halifax. I have got the best Adhesive in the Maritimes if you have got the Tabs!'"
        },
        {
            id: 'e7',
            title: 'ACID RAIN MIST',
            text: 'WEATHER: Yellow clouds are rolling in from the coast. Seek shelter or take +2 RADS.'
        },
        {
            id: 'e8',
            title: 'MYSTERIOUS RADIO SIGNAL',
            text: 'SIGNAL: A strange, upbeat fiddle tune is playing on a loop. It fills you with Nova Scotian pride. (+1 Politeness temporarily).'
        },
        {
            id: 'e9',
            title: 'KITCHEN PARTY NOISE',
            text: 'SOUND: You hear the faint sound of a kitchen party in the distance. Following the noise might lead to a safe settlement.'
        },
        {
            id: 'e10',
            title: 'LOST SUPPLY CRATE',
            text: 'ALERT: A crate tipped over in the hallway. Recover and sort the supplies before they are lost.'
        },
        {
            id: 'e11',
            title: 'STATIC MATH BURST',
            text: 'TRANSMISSION: Solve a quick 5-question math check to decode the next waypoint.'
        },
        {
            id: 'e12',
            title: 'BLANKET FORT BREACH',
            text: 'WARNING: Fort wall unstable. Reinforce with teamwork and safe setup.'
        },
        {
            id: 'e13',
            title: 'FRIENDLY TRADER KID',
            text: 'A young trader offers tips: clean fast, share supplies, and everyone profits.'
        },
        {
            id: 'e14',
            title: 'SUNSET RECALL',
            text: 'COMMAND: Final mission of the day. Complete one fast cleanup before debrief.'
        }
    ],
    tradeOffers: [
        { id: 't1', vendor: 'Masstown Merchant', offers: [{ item: 'Stimpak', cost: 20 }] },
        { id: 't2', vendor: 'Vault Overseer', offers: [{ item: 'Pop Tabs', cost: 10 }] }
    ],
    recipes: [
        {
            id: 'r1',
            name: 'BLUENOSE BAYONET',
            desc: 'A reach weapon that deals extra damage to Rad-Skeeters.',
            ingredients: [{ type: 'maritimeMetal', amount: 3 }],
            output: { item: 'Bluenose Bayonet', qty: 1 }
        },
        {
            id: 'r2',
            name: 'TRAPPER\'S PLATE',
            desc: 'High-resistance armor that makes the wearer immune to the Red Mud agility penalty.',
            ingredients: [{ type: 'maritimeMetal', amount: 5 }, { type: 'plaidScraps', amount: 3 }],
            output: { item: 'Trapper\'s Plate', qty: 1 }
        },
        {
            id: 'r3',
            name: 'PROPANE POPPER',
            desc: 'A makeshift grenade that causes a massive fire AOE, perfect for clearing out swarms.',
            ingredients: [{ type: 'propaneTank', amount: 2 }, { type: 'syntheticSap', amount: 3 }],
            output: { item: 'Propane Popper', qty: 1 }
        },
        {
            id: 'r4',
            name: 'DONAIR-DAB KIT',
            desc: 'A powerful healing item (50% HP) but adds +10 RADS unless you have LEAD BELLY perk.',
            ingredients: [{ type: 'radMeat', amount: 2 }, { type: 'spices', amount: 2 }, { type: 'cleanWater', amount: 2 }],
            output: { item: 'Donair-Dab Kit', qty: 1 }
        },
        {
            id: 'r5',
            name: 'STIMPAK',
            desc: 'Restores 4 HP.',
            ingredients: [{ type: 'syntheticSap', amount: 2 }],
            output: { item: 'Stimpak', qty: 1 }
        },
        {
            id: 'r6',
            name: 'RAD-AWAY',
            desc: 'Removes 2 Rads.',
            ingredients: [{ type: 'syntheticSap', amount: 3 }],
            output: { item: 'Rad-Away', qty: 1 }
        },
        {
            id: 'r7',
            name: 'PEGGY\'S COVE CLEATS',
            desc: 'Studded shoreline boots. +1 Agility and +1 Hardiness when crafted (one-time).',
            ingredients: [{ type: 'maritimeMetal', amount: 3 }, { type: 'plaidScraps', amount: 2 }],
            output: { item: 'Peggy\'s Cove Cleats', qty: 1 }
        },
        {
            id: 'r8',
            name: 'BASIN FOG LENS',
            desc: 'A salvaged monocle tuned for coastal haze. +1 Perception when crafted (one-time).',
            ingredients: [{ type: 'hubCircuitry', amount: 2 }, { type: 'cleanWater', amount: 2 }],
            output: { item: 'Basin Fog Lens', qty: 1 }
        },
        {
            id: 'r9',
            name: 'APPLE-CORE SASH',
            desc: 'A Valley propaganda sash that boosts confidence. +1 Charm and +1 Politeness when crafted (one-time).',
            ingredients: [{ type: 'plaidScraps', amount: 3 }, { type: 'spices', amount: 2 }],
            output: { item: 'Apple-Core Sash', qty: 1 }
        },
        {
            id: 'r10',
            name: 'SCOUT NOTEBOOK',
            desc: 'A field notebook for mission reports. Gain +1 Perception when crafted (one-time).',
            ingredients: [{ type: 'plaidScraps', amount: 2 }, { type: 'cleanWater', amount: 2 }],
            output: { item: 'Scout Notebook', qty: 1 }
        },
        {
            id: 'r11',
            name: 'SIGNAL FLAG KIT',
            desc: 'A bright signal kit for team communication. Grants +1 Politeness when crafted (one-time).',
            ingredients: [{ type: 'plaidScraps', amount: 2 }, { type: 'syntheticSap', amount: 2 }],
            output: { item: 'Signal Flag Kit', qty: 1 }
        },
        {
            id: 'r12',
            name: 'TRAIL MIX PACK',
            desc: 'Quick snack ration. Restores 2 HP and grants +2 Tabs.',
            ingredients: [{ type: 'spices', amount: 2 }, { type: 'radMeat', amount: 2 }],
            output: { item: 'Trail Mix Pack', qty: 1 }
        }
    ],
    quarterUpgrades: [
        {
            id: 'qupg1',
            name: 'STRUCTURAL REINFORCEMENT',
            desc: 'Clothespins and binder clips reinforce tent walls against Room-Draft Rad-storms.',
            tier: 1,
            cost: 100,
            stat: 'hardiness',
            statBoost: 1,
            effect: 'Vault walls are now taut and resistant to radiation storms.'
        },
        {
            id: 'qupg2',
            name: 'TACTICAL LUMENS',
            desc: 'Battery-powered fairy lights illuminate the Vault at night.',
            tier: 1,
            cost: 150,
            stat: 'perception',
            statBoost: 1,
            effect: 'Lights prevent stubbed toes and improve nighttime visibility.'
        },
        {
            id: 'qupg3',
            name: 'SOFT-FLOOR PROTOCOL',
            desc: 'Extra yoga mats and rugs create cushioned flooring.',
            tier: 1,
            cost: 200,
            stat: null,
            hpRecovery: 'full',
            effect: 'Sleeping in the Vault now fully restores Health.'
        },
        {
            id: 'qupg4',
            name: 'SALVAGED SUPPLY BIN',
            desc: 'A plastic bin or cardboard crate inside the Vault for storage.',
            tier: 1,
            cost: 120,
            stat: null,
            inventorySlots: 3,
            effect: 'Store up to 3 extra pieces of scrap without carry weight penalties.'
        },
        {
            id: 'qupg5',
            name: 'DELTA MASCOT POSTER',
            desc: 'A drawing or photo of the Company mascot pinned to the Vault wall.',
            tier: 1,
            cost: 90,
            stat: 'charm',
            statBoost: 1,
            effect: 'Familiar face boosts morale and negotiation with factions.'
        },
        {
            id: 'qupg6',
            name: 'AIR-LOCK SEALANT',
            desc: 'Duct tape and masking tape seal the blanket fort seams.',
            tier: 1,
            cost: 80,
            stat: null,
            specialEffect: 'skeeterImmunity',
            effect: 'Immune to Rad-Skeeter Swarm encounters while inside the Vault.'
        },
        {
            id: 'qupg7',
            name: 'RATION DISPENSER',
            desc: 'A dedicated bowl or container for session snacks inside the Vault.',
            tier: 1,
            cost: 160,
            stat: null,
            specialEffect: 'fortifiedRecovery',
            effect: '+1 Hardiness for the duration of the next Wasteland Encounter.'
        },
        {
            id: 'qupg8',
            name: 'SCRAP-COMMS LINK',
            desc: 'Tin can phone, toy walkie-talkie, or colored string between Vaults.',
            tier: 1,
            cost: 200,
            stat: null,
            specialEffect: 'assistBonus',
            effect: 'Once per session, call the other survivor for +1 to any C.H.A.P.P.Y. roll.'
        },
        {
            id: 'qs1',
            type: 'item',
            repeatable: true,
            name: 'STIMPAK KIT',
            desc: 'One-use medical injector for emergency healing. Consumed on purchase.',
            cost: 35,
            shopEffect: { type: 'heal', amount: 4 },
            effect: 'Use now: restores 4 HP.'
        },
        {
            id: 'qs2',
            type: 'item',
            repeatable: true,
            name: 'RAD-AWAY DOSE',
            desc: 'Portable anti-rad dose for field cleanup. Consumed on purchase.',
            cost: 40,
            shopEffect: { type: 'radAway', amount: 2 },
            effect: 'Use now: removes 2 RADS.'
        },
        {
            id: 'qs3',
            type: 'item',
            repeatable: true,
            name: 'SNACK RATION PACK',
            desc: 'Quick morale boost and travel snack. Consumed on purchase.',
            cost: 25,
            shopEffect: { type: 'healAndTabs', heal: 2, tabs: 2 },
            effect: 'Use now: restores 2 HP and grants +2 Tabs.'
        },
        {
            id: 'qs4',
            type: 'item',
            repeatable: true,
            name: 'SCRAP TOOL ROLL',
            desc: 'Basic tool wrap for repair tasks and tinkering. Consumed on purchase.',
            cost: 55,
            shopEffect: {
                type: 'scrapBundle',
                rolls: 3,
                minAmount: 1,
                maxAmount: 2,
                pool: ['maritimeMetal', 'syntheticSap', 'hubCircuitry', 'plaidScraps', 'propaneTank', 'radMeat', 'spices', 'cleanWater']
            },
            effect: 'Use now: grants a random bundle of scrap materials.'
        }
    ],
    trades: [],
    overseerInbox: []
};

function createInitialGameState() {
    return JSON.parse(JSON.stringify(BASE_GAME_STATE));
}

function mergeMissingDefaults(target, defaults) {
    if (Array.isArray(defaults)) {
        return Array.isArray(target) ? target : JSON.parse(JSON.stringify(defaults));
    }

    if (defaults && typeof defaults === 'object') {
        const source = (target && typeof target === 'object' && !Array.isArray(target)) ? target : {};
        const merged = { ...source };

        Object.entries(defaults).forEach(([key, defaultValue]) => {
            merged[key] = mergeMissingDefaults(source[key], defaultValue);
        });

        return merged;
    }

    return target === undefined ? defaults : target;
}

function mergeCatalogById(existingList, defaultList) {
    const safeExisting = Array.isArray(existingList) ? existingList : [];
    const safeDefaults = Array.isArray(defaultList) ? defaultList : [];

    const existingIds = new Set(
        safeExisting
            .map(item => item && typeof item === 'object' ? item.id : null)
            .filter(Boolean)
    );

    const additions = safeDefaults
        .filter(item => item && typeof item === 'object' && item.id && !existingIds.has(item.id))
        .map(item => JSON.parse(JSON.stringify(item)));

    return [...safeExisting, ...additions];
}

let gameState = createInitialGameState();

function ensureSaveDirectories() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function rotateBackups() {
    try {
        const backupFiles = fs.readdirSync(BACKUP_DIR)
            .filter(name => name.endsWith('.json'))
            .map(name => ({
                name,
                fullPath: path.join(BACKUP_DIR, name),
                mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs
            }))
            .sort((a, b) => b.mtime - a.mtime);

        const removable = backupFiles.slice(Math.max(0, SAVE_BACKUP_LIMIT));
        removable.forEach(file => fs.unlinkSync(file.fullPath));
    } catch (error) {
        console.error('Backup rotation failed:', error.message);
    }
}

function writeBackupSnapshot() {
    try {
        const stamp = new Date().toISOString().replace(/[.:]/g, '-');
        const backupFile = path.join(BACKUP_DIR, `game-state-${stamp}.json`);
        fs.copyFileSync(SAVE_FILE_PATH, backupFile);
        rotateBackups();
    } catch (error) {
        console.error('Backup snapshot failed:', error.message);
    }
}

function parseLoadedState(candidateState, sourceLabel) {
    if (!candidateState || typeof candidateState !== 'object' || !candidateState.players) {
        return false;
    }

    const oldVer = candidateState.version || 1;
    const migratedState = migrateGameState(candidateState);
    if (!migratedState) {
        return false;
    }

    gameState = migratedState;
    console.log(`Loaded game state (${oldVer} -> ${GAME_STATE_VERSION}) from ${sourceLabel}`);
    return true;
}

async function persistGameStateToSupabase(reason = 'autosave') {
    const timestamp = new Date().toISOString();
    const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`;
    const payload = [{
        id: SUPABASE_STATE_ID,
        state: gameState,
        updated_at: timestamp
    }];

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase save failed (${response.status}): ${body}`);
    }

    lastSavedAt = timestamp;
    if (reason !== 'debounced') {
        console.log(`Game state persisted to Supabase (${reason}) at ${lastSavedAt}`);
    }
}

function persistGameStateToDisk(reason = 'autosave') {
    ensureSaveDirectories();
    const tempPath = `${SAVE_FILE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(gameState, null, 2), 'utf8');
    fs.renameSync(tempPath, SAVE_FILE_PATH);
    writeBackupSnapshot();
    lastSavedAt = new Date().toISOString();
    if (reason !== 'debounced') {
        console.log(`Game state persisted (${reason}) at ${lastSavedAt}`);
    }
}

async function persistGameState(reason = 'autosave', force = false) {
    if (!force && !hasUnsavedChanges) {
        return;
    }

    if (saveInFlight) {
        saveQueued = true;
        return;
    }

    saveInFlight = true;

    do {
        saveQueued = false;
        try {
            gameState.version = GAME_STATE_VERSION;
            if (SUPABASE_ENABLED) {
                await persistGameStateToSupabase(reason);
            } else {
                persistGameStateToDisk(reason);
            }
            hasUnsavedChanges = false;
        } catch (error) {
            console.error(`Save failed (${reason}):`, error.message);
        }
    } while (saveQueued && (force || hasUnsavedChanges));

    saveInFlight = false;
}

function scheduleAutoSave() {
    hasUnsavedChanges = true;
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
        persistGameState('debounced').catch(error => {
            console.error('Debounced save failed:', error.message);
        });
    }, SAVE_DEBOUNCE_MS);
}

function startPeriodicAutoSave() {
    if (periodicSaveTimer) {
        clearInterval(periodicSaveTimer);
    }

    periodicSaveTimer = setInterval(() => {
        persistGameState('periodic').catch(error => {
            console.error('Periodic save failed:', error.message);
        });
    }, PERIODIC_SAVE_MS);
}

function migrateGameState(loadedState) {
    if (!loadedState) return null;

    const mergedState = mergeMissingDefaults(loadedState, BASE_GAME_STATE);

    mergedState.perks = mergeCatalogById(mergedState.perks, BASE_GAME_STATE.perks);
    mergedState.statusEffects = mergeCatalogById(mergedState.statusEffects, BASE_GAME_STATE.statusEffects);
    mergedState.quests = mergeCatalogById(mergedState.quests, BASE_GAME_STATE.quests);
    mergedState.randomQuests = mergeCatalogById(mergedState.randomQuests, BASE_GAME_STATE.randomQuests);
    mergedState.educationalQuests = mergeCatalogById(mergedState.educationalQuests, BASE_GAME_STATE.educationalQuests);
    const educationalDefaultsById = new Map((BASE_GAME_STATE.educationalQuests || []).map((quest) => [quest.id, quest]));
    mergedState.educationalQuests = (mergedState.educationalQuests || []).map((quest) => {
        const defaults = educationalDefaultsById.get(quest?.id);
        return defaults ? mergeMissingDefaults(quest, defaults) : quest;
    });
    mergedState.radioSignals = mergeCatalogById(mergedState.radioSignals, BASE_GAME_STATE.radioSignals);
    mergedState.broadcastSignals = mergeCatalogById(mergedState.broadcastSignals, BASE_GAME_STATE.broadcastSignals);
    mergedState.randomEncounters = mergeCatalogById(mergedState.randomEncounters, BASE_GAME_STATE.randomEncounters);
    mergedState.recipes = mergeCatalogById(mergedState.recipes, BASE_GAME_STATE.recipes);
    mergedState.quarterUpgrades = mergeCatalogById(mergedState.quarterUpgrades, BASE_GAME_STATE.quarterUpgrades);
    const quarterDefaultsById = new Map((BASE_GAME_STATE.quarterUpgrades || []).map((upgrade) => [upgrade.id, upgrade]));
    mergedState.quarterUpgrades = (mergedState.quarterUpgrades || []).map((upgrade) => {
        const defaults = quarterDefaultsById.get(upgrade?.id);
        return defaults ? { ...upgrade, ...defaults } : upgrade;
    });
    mergedState.eventCards = mergeCatalogById(mergedState.eventCards, BASE_GAME_STATE.eventCards);
    mergedState.achievements = mergeCatalogById(mergedState.achievements, BASE_GAME_STATE.achievements);
    mergedState.teamObjectives = mergeCatalogById(mergedState.teamObjectives, BASE_GAME_STATE.teamObjectives);
    mergedState.questChains = mergeCatalogById(mergedState.questChains, BASE_GAME_STATE.questChains);

    if (mergedState.players) {
        Object.values(mergedState.players).forEach((playerData) => {
            ensurePlayerProgressFields(playerData);
            if ((loadedState.version || 1) < 6) {
                playerData.educationalBoard = null;
            }
        });
    }

    // Always update version to current
    mergedState.version = GAME_STATE_VERSION;

    return mergedState;
}

function loadGameStateFromDisk() {
    ensureSaveDirectories();

    const parseSaveFile = (filePath) => {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const loadedState = JSON.parse(fileContent);
        return parseLoadedState(loadedState, filePath);
    };

    if (fs.existsSync(SAVE_FILE_PATH)) {
        try {
            if (parseSaveFile(SAVE_FILE_PATH)) {
                return;
            }
        } catch (error) {
            console.error('Primary save load failed, trying backup:', error.message);
        }
    }

    try {
        const backupFiles = fs.readdirSync(BACKUP_DIR)
            .filter(name => name.endsWith('.json'))
            .map(name => ({
                name,
                fullPath: path.join(BACKUP_DIR, name),
                mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs
            }))
            .sort((a, b) => b.mtime - a.mtime);

        for (const backup of backupFiles) {
            try {
                if (parseSaveFile(backup.fullPath)) {
                    persistGameState('restore-from-backup', true);
                    return;
                }
            } catch {
                continue;
            }
        }
    } catch (error) {
        console.error('Backup restore scan failed:', error.message);
    }

    console.log('No valid save found; starting with fresh game state.');
}

async function loadGameStateFromSupabase() {
    const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${SUPABASE_STATE_ID}&select=state,updated_at&limit=1`;
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase load failed (${response.status}): ${body}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
        console.log('No Supabase save row found; starting with fresh game state.');
        return;
    }

    const loaded = rows[0]?.state;
    if (parseLoadedState(loaded, 'Supabase')) {
        lastSavedAt = rows[0]?.updated_at || null;
        return;
    }

    console.log('Supabase row found but invalid; starting with fresh game state.');
}

async function initializeGameState() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        if (SUPABASE_URL || SUPABASE_SERVICE_ROLE_KEY) {
            console.warn('Supabase env is partially configured; using filesystem persistence fallback.');
        }
        loadGameStateFromDisk();
        return;
    }

    try {
        await loadGameStateFromSupabase();
    } catch (error) {
        console.error('Supabase load unavailable, falling back to filesystem:', error.message);
        loadGameStateFromDisk();
    }
}

function flushSaveOnExit() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    if (periodicSaveTimer) {
        clearInterval(periodicSaveTimer);
        periodicSaveTimer = null;
    }
    return persistGameState('shutdown', true);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getXpRequiredForLevel(level) {
    const safeLevel = Math.max(1, Number(level) || 1);
    return 5 + ((safeLevel - 1) * 3);
}

const CHAPPY_STATS = ['charm', 'hardiness', 'agility', 'perception', 'politeness', 'yarns'];
const PERK_RUNTIME_BONUSES = {
    p1: { stats: { hardiness: 1 } },
    p2: { maxRads: 2 },
    p3: { stats: { politeness: 1 } },
    p4: { stats: { charm: 1 } },
    p5: { stats: { perception: 1 } },
    p6: {},
    p7: { stats: { agility: 1 } },
    p8: { stats: { perception: 1 } },
    p9: { stats: { charm: 2 } },
    p10: { stats: { agility: 1 } },
    p11: { stats: { perception: 1 } },
    p12: { stats: { perception: 1 } },
    p13: { stats: { hardiness: 1 } },
    p14: { stats: { charm: 1, politeness: 1 } },
    p15: { stats: { agility: 2 } },
    p16: {},
    p17: { stats: { yarns: 1, perception: 1 } },
    p18: { stats: { charm: 1 } },
    p19: { stats: { hardiness: 1 } },
    p20: { stats: { perception: 1 } },
    p21: { stats: { agility: 1 } }
};

function ensurePlayerProgressFields(playerData) {
    if (!playerData || typeof playerData !== 'object') {
        return;
    }

    if (!Number.isFinite(playerData.level) || playerData.level < 1) {
        playerData.level = 1;
    }

    if (!Number.isFinite(playerData.xp) || playerData.xp < 0) {
        playerData.xp = 0;
    }

    const baseMaxHp = 10;
    const baseMaxRads = 10;
    const levelBasedBonus = Math.max(0, playerData.level - 1);
    const unlockedPerks = Array.isArray(playerData.unlockedPerks) ? playerData.unlockedPerks : [];
    const perkCatalogById = new Map((BASE_GAME_STATE.perks || []).map((perk) => [perk.id, perk]));

    const desiredBonuses = unlockedPerks.reduce((acc, perkId) => {
        const perk = perkCatalogById.get(perkId);
        if (perk) {
            acc.maxHp += Number(perk.maxHpBonus || 0);
            acc.maxRads += Number(perk.maxRadsBonus || 0);
        }

        const runtimeBonus = PERK_RUNTIME_BONUSES[perkId] || {};
        acc.maxHp += Number(runtimeBonus.maxHp || 0);
        acc.maxRads += Number(runtimeBonus.maxRads || 0);

        if (runtimeBonus.stats && typeof runtimeBonus.stats === 'object') {
            Object.entries(runtimeBonus.stats).forEach(([stat, amount]) => {
                if (!CHAPPY_STATS.includes(stat)) {
                    return;
                }
                acc.stats[stat] = Number(acc.stats[stat] || 0) + Number(amount || 0);
            });
        }

        return acc;
    }, {
        maxHp: 0,
        maxRads: 0,
        stats: Object.fromEntries(CHAPPY_STATS.map((stat) => [stat, 0]))
    });

    const appliedBonuses = playerData._appliedPerkBonuses && typeof playerData._appliedPerkBonuses === 'object'
        ? playerData._appliedPerkBonuses
        : { stats: Object.fromEntries(CHAPPY_STATS.map((stat) => [stat, 0])) };
    if (!appliedBonuses.stats || typeof appliedBonuses.stats !== 'object') {
        appliedBonuses.stats = Object.fromEntries(CHAPPY_STATS.map((stat) => [stat, 0]));
    }

    if (!playerData.stats || typeof playerData.stats !== 'object') {
        playerData.stats = Object.fromEntries(CHAPPY_STATS.map((stat) => [stat, 1]));
    }

    CHAPPY_STATS.forEach((stat) => {
        const desired = Number(desiredBonuses.stats[stat] || 0);
        const applied = Number(appliedBonuses.stats[stat] || 0);
        const delta = desired - applied;
        if (delta !== 0) {
            const current = Number(playerData.stats[stat] || 0);
            playerData.stats[stat] = Math.max(0, current + delta);
        }
        appliedBonuses.stats[stat] = desired;
    });
    playerData._appliedPerkBonuses = appliedBonuses;

    const requiredMaxHp = baseMaxHp + levelBasedBonus + desiredBonuses.maxHp;
    const requiredMaxRads = baseMaxRads + levelBasedBonus + desiredBonuses.maxRads;

    const currentMaxHp = Number(playerData.maxHp);
    const currentMaxRads = Number(playerData.maxRads);
    playerData.maxHp = Number.isFinite(currentMaxHp) ? requiredMaxHp : requiredMaxHp;
    playerData.maxRads = Number.isFinite(currentMaxRads) ? requiredMaxRads : requiredMaxRads;

    playerData.hp = clamp(Number(playerData.hp || 0), 0, playerData.maxHp);
    playerData.rads = clamp(Number(playerData.rads || 0), 0, playerData.maxRads);

    const effectCatalogById = new Map((BASE_GAME_STATE.statusEffects || []).map((effect) => [effect.id, effect]));
    const activeEffectIds = Array.isArray(playerData.activeEffects) ? playerData.activeEffects : [];
    playerData.skipNextTurn = activeEffectIds.some((effectId) => {
        const effect = effectCatalogById.get(effectId);
        return Boolean(effect?.effects?.skipNextTurn);
    });

    playerData.xpToNext = getXpRequiredForLevel(playerData.level);
}

function getRandomScrapType(player) {
    const scrap = gameState.players[player].scrap || {};
    const keys = Object.keys(scrap);
    if (keys.length === 0) {
        return null;
    }
    return keys[Math.floor(Math.random() * keys.length)];
}

function getActiveEffectModifierSum(playerData, key) {
    const effectById = new Map((gameState.statusEffects || []).map((effect) => [effect.id, effect]));
    const activeEffectModifiers = (Array.isArray(playerData?.activeEffects) ? playerData.activeEffects : [])
        .map((effectId) => effectById.get(effectId))
        .filter((effect) => effect && effect.modifiers && typeof effect.modifiers === 'object')
        .map((effect) => effect.modifiers);

    return activeEffectModifiers.reduce((sum, modifiers) => sum + Number(modifiers[key] || 0), 0);
}

function resolveEncounterOutcome(player, encounter) {
    const roll = Math.floor(Math.random() * 20) + 1;
    let hpDelta = 0;
    let radDelta = 0;
    let tabsDelta = 0;
    let scrapType = null;
    let scrapDelta = 0;
    let label = 'MIXED';

    if (roll <= 5) {
        hpDelta = -2;
        radDelta = 2;
        label = 'DANGER';
    } else if (roll <= 10) {
        hpDelta = -1;
        radDelta = 1;
        tabsDelta = 5;
        label = 'ROUGH';
    } else if (roll <= 15) {
        tabsDelta = 10;
        scrapDelta = 1;
        label = 'CLEAR';
    } else {
        hpDelta = 1;
        tabsDelta = 15;
        scrapDelta = 2;
        label = 'LUCKY';
    }

    if (scrapDelta > 0) {
        scrapType = getRandomScrapType(player);
    }

    const playerData = gameState.players[player];
    if (hpDelta < 0) {
        const hpLoss = Math.abs(hpDelta);
        const adjustedLoss = Math.max(0, hpLoss + getActiveEffectModifierSum(playerData, 'hpLossBonus') - getActiveEffectModifierSum(playerData, 'hpLossReduction'));
        hpDelta = -adjustedLoss;
    }

    if (radDelta > 0) {
        radDelta = Math.max(0, radDelta + getActiveEffectModifierSum(playerData, 'radGainBonus') - getActiveEffectModifierSum(playerData, 'radGainReduction'));
    }

    if (tabsDelta > 0) {
        tabsDelta = Math.max(0, tabsDelta + getActiveEffectModifierSum(playerData, 'tabsGainBonus'));
    }

    if (scrapDelta > 0) {
        scrapDelta = Math.max(0, scrapDelta + getActiveEffectModifierSum(playerData, 'scrapRewardBonus'));
    }

    playerData.hp = clamp((playerData.hp || 0) + hpDelta, 0, playerData.maxHp || 10);
    playerData.rads = clamp((playerData.rads || 0) + radDelta, 0, playerData.maxRads || 10);
    playerData.tabs = Math.max(0, (playerData.tabs || 0) + tabsDelta);
    if (scrapType) {
        playerData.scrap[scrapType] = (playerData.scrap[scrapType] || 0) + scrapDelta;
    }

    const effects = [];
    if (hpDelta !== 0) {
        effects.push(`HP ${hpDelta > 0 ? '+' : ''}${hpDelta}`);
    }
    if (radDelta !== 0) {
        effects.push(`RADS ${radDelta > 0 ? '+' : ''}${radDelta}`);
    }
    if (tabsDelta !== 0) {
        effects.push(`TABS +${tabsDelta}`);
    }
    if (scrapType && scrapDelta > 0) {
        effects.push(`${scrapType} +${scrapDelta}`);
    }

    return {
        roll,
        label,
        effects: effects.length > 0 ? effects.join(', ') : 'NO CHANGE'
    };
}

function addInventoryItem(player, name) {
    const item = {
        id: `item-${Date.now()}`,
        name: name,
        qty: 1
    };
    gameState.players[player].inventory.push(item);
}

function applyEncounterOutcome(player) {
    const playerData = gameState.players[player];

    const applyAdjustedHpLoss = (baseLoss) => {
        const adjustedLoss = Math.max(0,
            Number(baseLoss || 0)
            + getActiveEffectModifierSum(playerData, 'hpLossBonus')
            - getActiveEffectModifierSum(playerData, 'hpLossReduction')
        );
        playerData.hp = clamp((playerData.hp || 0) - adjustedLoss, 0, playerData.maxHp || 10);
    };

    const applyAdjustedRadsGain = (baseGain) => {
        const adjustedGain = Math.max(0,
            Number(baseGain || 0)
            + getActiveEffectModifierSum(playerData, 'radGainBonus')
            - getActiveEffectModifierSum(playerData, 'radGainReduction')
        );
        playerData.rads = clamp((playerData.rads || 0) + adjustedGain, 0, playerData.maxRads || 10);
    };

    const applyAdjustedTabsGain = (baseGain) => {
        const adjustedGain = Math.max(0,
            Number(baseGain || 0)
            + getActiveEffectModifierSum(playerData, 'tabsGainBonus')
        );
        playerData.tabs = Math.max(0, (playerData.tabs || 0) + adjustedGain);
        return adjustedGain;
    };

    const applyAdjustedScrapGain = (baseGain) => {
        const adjustedGain = Math.max(0,
            Number(baseGain || 0)
            + getActiveEffectModifierSum(playerData, 'scrapRewardBonus')
        );
        if (adjustedGain <= 0) {
            return 'NO SCRAP GAIN';
        }

        const scrapType = getRandomScrapType(player);
        if (scrapType) {
            playerData.scrap[scrapType] = (playerData.scrap[scrapType] || 0) + adjustedGain;
            return `${scrapType} +${adjustedGain}`;
        }
        return 'NO SCRAP AVAILABLE';
    };

    const outcomes = [
        { id: 'lose_hp', text: 'LOSE 2 HEALTH', apply: () => { applyAdjustedHpLoss(2); } },
        { id: 'gain_rads_2', text: 'GAIN 2 RADS', apply: () => { applyAdjustedRadsGain(2); } },
        { id: 'gain_rads_4', text: 'GAIN 4 RADS', apply: () => { applyAdjustedRadsGain(4); } },
        { id: 'gain_tabs_2', text: 'GAIN 2 TABS', apply: () => {
            const gained = applyAdjustedTabsGain(2);
            return `TABS +${gained}`;
        } },
        { id: 'gain_resource', text: 'GAIN RANDOM RESOURCE', apply: () => applyAdjustedScrapGain(1) },
        { id: 'gain_stimpak', text: 'GAIN STIMPAK', apply: () => { addInventoryItem(player, 'Stimpak'); } },
        { id: 'gain_radaway', text: 'GAIN RAD-AWAY', apply: () => { addInventoryItem(player, 'Rad-Away'); } }
    ];

    const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
    const extra = outcome.apply(playerData);
    return {
        id: outcome.id,
        text: outcome.text,
        extra: extra || null
    };
}

registerGmRoutes(app, {
    getStorageStatus,
    persistGameState,
    getLastSavedAt: () => lastSavedAt
});

registerPlayerRoutes(app, {
    getGameState: () => gameState,
    ensurePlayerProgressFields,
    getXpRequiredForLevel,
    scheduleAutoSave
});

registerGameplayRoutes(app, {
    getGameState: () => gameState,
    setGameState: (nextState) => {
        gameState = nextState;
    },
    createInitialGameState,
    migrateGameState,
    persistGameState,
    scheduleAutoSave,
    ensurePlayerProgressFields,
    getXpRequiredForLevel,
    validateNumber,
    validateNumericRecord,
    clamp,
    applyEncounterOutcome,
    getGameStateVersion: () => GAME_STATE_VERSION
});

// --- SERVER START ---
async function startServer() {
    await initializeGameState();
    startPeriodicAutoSave();

    app.listen(PORT, () => {
    const hostname = os.hostname();
    const interfaces = os.networkInterfaces();
    let localIP = '127.0.0.1';
    
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIP = iface.address;
                break;
            }
        }
    }
    
    const gmUrl = `http://${localIP}:${PORT}/gm-dashboard.html`;
    const loganUrl = `http://${localIP}:${PORT}/player.html?player=logan`;
    const rylynUrl = `http://${localIP}:${PORT}/player.html?player=rylyn`;
    
        console.log(`
╔════════════════════════════════════════════════════════════╗
║  FALLOUT: NEW NOVA SCOTIA - GAME MASTER SERVER STARTED    ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  📊 GM DASHBOARD:                                          ║
║  ${gmUrl}
║                                                            ║
║  👤 LOGAN:                                                 ║
║  ${loganUrl}
║                                                            ║
║  👤 RYLYN:                                                 ║
║  ${rylynUrl}
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
    });
}

startServer().catch(error => {
    console.error('Failed to start server:', error.message);
    process.exit(1);
});


// Graceful shutdown handlers to save game state
process.on('SIGINT', () => {
    console.log('\nServer shutting down. Saving game state...');
    flushSaveOnExit().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
    console.log('\nServer terminating. Saving game state...');
    flushSaveOnExit().finally(() => process.exit(0));
});
