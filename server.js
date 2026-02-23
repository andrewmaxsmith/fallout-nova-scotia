const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_DIR = process.env.DATA_VOLUME_PATH || __dirname;
const SAVE_FILE_PATH = path.join(DATA_DIR, 'game-state.json');
const SAVE_DEBOUNCE_MS = 500;
const GAME_STATE_VERSION = 2; // Increment when schema changes

let saveTimeout = null;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'gm-dashboard.html'));
});

app.get('/healthz', (req, res) => {
    res.status(200).json({ ok: true });
});

// Game state with version tracking for migration
let gameState = {
    version: GAME_STATE_VERSION,
    players: {
        logan: {
            name: 'Logan',
            level: 1,
            xp: 0,
            hp: 10,
            maxHp: 10,
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
            activeEffects: []
        },
        rylyn: {
            name: 'Rylyn',
            level: 1,
            xp: 0,
            hp: 10,
            maxHp: 10,
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
            activeEffects: []
        }
    },
    perks: [
        { id: 'p1', name: "IRON CALVES", desc: "Climbing Jacob's Ladder no longer causes HP loss.", tier: 1 },
        { id: 'p2', name: "AQUA-BLUENOSER", desc: "Immune to Radiation while at the shoreline.", tier: 1 },
        { id: 'p3', name: "THRIFTY TOWNIE", desc: "Gain 2 extra Pop Tabs from every quest.", tier: 2 },
        { id: 'p4', name: "DONAIR DIGESTION", desc: "Healing items (snacks) restore double HP.", tier: 1 },
        { id: 'p5', name: "SCRAPPER", desc: "50% chance to find double scrap items.", tier: 2 },
        { id: 'p6', name: "LEAD BELLY", desc: "Eating 'Red Mud' food causes 0 Radiation.", tier: 1 },
        { id: 'p7', name: "WASTELAND WAND", desc: "+1 Agility on trails and outdoor areas.", tier: 2 },
        { id: 'p8', name: "SCAVENGER'S EYE", desc: "+1 Perception for finding hidden items.", tier: 3 },
        { id: 'p9', name: "PLAID PRIDE", desc: "+2 Charisma with faction members.", tier: 2 },
        { id: 'p10', name: "QUICK-HANDS", desc: "+10% attack speed with melee weapons.", tier: 3 },
        { id: 'p11', name: "TIDAL MASTER", desc: "Predict Tidal Bore patterns; cross safely at any time.", tier: 2 },
        { id: 'p12', name: "FOG WALKER", desc: "Move freely through radioactive fog without vision penalty.", tier: 3 },
        { id: 'p13', name: "COVE CLIMBER", desc: "Scaling any cliff or rock formation grants +1 to next action.", tier: 2 },
        { id: 'p14', name: "KITCHEN PARTY", desc: "Social encounters grant +15% charm and +10% tabs reward.", tier: 1 },
        { id: 'p15', name: "LOBSTER REFLEXES", desc: "Dodge incoming damage with +2 to agility checks.", tier: 3 },
        { id: 'p16', name: "HIGHLAND HARDNESS", desc: "+3 Max HP. You're built for the brutal Nova Scotia terrain.", tier: 2 },
        { id: 'p17', name: "RADIO TUNER", desc: "Unlock 3 additional radio signals beyond normal broadcasts.", tier: 1 }
    ],
    statusEffects: [
        {
            id: 'se1',
            name: "DONAIR SWEATS",
            desc: "You smell so strongly of garlic and spiced beef that you can't sneak, and people don't want to talk to you.",
            trigger: "Consuming low-quality Mystery Meat",
            type: 'debuff',
            effects: { agility: -1, politeness: -1 },
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
            durationMinutes: 15
        },
        {
            id: 'se4',
            name: "BLACK ROCK SLIP",
            desc: "You didn't stay off the black rocks at Peggy's Cove. The Atlantic Ocean humbled you.",
            trigger: "Rolling a 1 near the coastline",
            type: 'debuff',
            effects: { hp: -3, hardiness: -1 },
            permanent: true
        },
        {
            id: 'se5',
            name: "OVER-POLITE STANDOFF",
            desc: "A classic Nova Scotian deadlock where nobody wants to be the one to go first.",
            trigger: "Encountering another player at a doorway or loot pile",
            type: 'mutual_debuff',
            effects: { skipNextTurn: true },
            durationTurns: 1
        }
    ],
    quests: [
        { id: 'h1', title: "VAULT: Sanitize Quarters", desc: "Clean your room until no scrap remains on the floor.", category: 'vault', rewardTabs: 10, rewardScrap: { syntheticSap: 1 }, xp: 1 },
        { id: 'h2', title: "VAULT: Nutrient Synthesis", desc: "Assist the Overseer with preparing a family meal.", category: 'vault', rewardTabs: 15, rewardScrap: { cleanWater: 1, spices: 1 }, xp: 1 },
        { id: 'h3', title: "VAULT: Static Discharge", desc: "Fold and put away a basket of clean laundry.", category: 'vault', rewardTabs: 10, rewardScrap: { plaidScraps: 1 }, xp: 1 },
        { id: 'q2', title: "The Great Drain", desc: "Visit Burncoat Head at low tide.", category: 'main', rewardTabs: 20, rewardScrap: { maritimeMetal: 2 }, xp: 1 },
        { id: 'q5', title: "Jacob's Ladder Trial", desc: "Complete the brutal 175 step challenge without falling.", category: 'main', rewardTabs: 45, rewardScrap: { hubCircuitry: 1 }, xp: 2 },
        { id: 'q6', title: "Witches' Cauldron Mystery", desc: "Dive into the radioactive pool and retrieve the pre-war crate.", category: 'main', rewardTabs: 45, rewardScrap: { radMeat: 1, cleanWater: 1 }, xp: 2 },
        { id: 'q11', title: "Battle for the Bazaar", desc: "Defend Masstown Market from Highway 104 Raiders.", category: 'main', rewardTabs: 100, rewardScrap: { maritimeMetal: 2, hubCircuitry: 2 }, xp: 3 },
        { id: 'q12', title: "The Tidal Bore Race", desc: "Gather all Scrap and Supplies and return to safety before the 5-minute tide rush!", category: 'side', rewardTabs: 50, rewardScrap: { maritimeMetal: 1, syntheticSap: 1 }, xp: 2 },
        { id: 'q13', title: "The Plaid Patch-Up", desc: "Find Plaid Scrap and use Synthetic Sap to patch the Vault air-lock before the next Rad-Storm.", category: 'side', rewardTabs: 35, rewardScrap: { plaidScraps: 2, syntheticSap: 1 }, xp: 1 },
        { id: 'q14', title: "Three-Crows Signal Boost", desc: "One player stands at the Highest Peak for 60 seconds while the other tunes the Pip-Boy. Recite the Wasteland Oath!", category: 'side', rewardTabs: 20, rewardScrap: { hubCircuitry: 1 }, xp: 1 },
        { id: 'q15', title: "The Junk-Jet Prototype", desc: "Collect 5 pieces of Scrap from different Biomes and justify each one to the Overseer.", category: 'side', rewardTabs: 60, rewardScrap: { propaneTank: 1, maritimeMetal: 1 }, xp: 2 },
        { id: 'q16', title: "Five Islands Provincial Park (The Great Drain)", desc: "Master the Mud-Slog and survive the Tidal Rush at the Great Drain.", category: 'main', rewardTabs: 55, rewardScrap: { maritimeMetal: 2, cleanWater: 1 }, xp: 2 },
        { id: 'q17', title: "Shubenacadie Wildlife Park (The Beast Pens)", desc: "Scout the perimeter and photograph three Wasteland Creatures without startling them.", category: 'main', rewardTabs: 50, rewardScrap: { radMeat: 1, spices: 1 }, xp: 2 }
    ],
    randomQuests: [
        { id: 'rq1', title: "HOUSE: Tidy the Living Room", desc: "Pick up toys and organize the space.", reward: 5, xp: 1 },
        { id: 'rq2', title: "HOUSE: Wash the Dishes", desc: "Clean and rinse all dishes in the sink.", reward: 5, xp: 1 },
        { id: 'rq3', title: "HOUSE: Make Your Bed", desc: "Pull covers tight and arrange pillows.", reward: 5, xp: 1 },
        { id: 'rq4', title: "HOUSE: Sweep the Kitchen", desc: "Clear crumbs and debris from the floor.", reward: 5, xp: 1 },
        { id: 'rq5', title: "CRAFT: Build a Lego Structure", desc: "Create and complete any Lego model.", reward: 8, xp: 1 },
        { id: 'rq6', title: "CRAFT: Draw or Paint", desc: "Create a piece of art and show it off.", reward: 8, xp: 1 },
        { id: 'rq7', title: "CRAFT: Assemble a Model", desc: "Build something cool from a kit.", reward: 10, xp: 1 },
        { id: 'rq8', title: "SPORT: Play Soccer in the Yard", desc: "Get some exercise kicking the ball.", reward: 8, xp: 1 },
        { id: 'rq9', title: "SPORT: Go for a Bike Ride", desc: "Ride your bike around the neighborhood.", reward: 10, xp: 1 },
        { id: 'rq10', title: "SPORT: Play Catch", desc: "Toss a ball back and forth.", reward: 5, xp: 1 },
        { id: 'rq11', title: "CHORE: Fold Laundry", desc: "Sort and fold clean clothes.", reward: 5, xp: 1 },
        { id: 'rq12', title: "CHORE: Take Out Trash", desc: "Empty the bins and replace bags.", reward: 5, xp: 1 },
        { id: 'rq13', title: "CHORE: Organize Closet", desc: "Sort and arrange your belongings.", reward: 8, xp: 1 }
    ],
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
        { id: 'r10', title: "BEAST PENS SIGHTING", text: "Movement detected at Shubenacadie Wildlife Park. Rad-Moose and Yao Guai variants confirmed. Scout teams deploy. Biological data required." }
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
        { id: 'b17', title: "THE OAK ISLAND PING", text: "Entry 4,002. We've dug another ten feet. We found a coconut fiber mat and a single pre-war bottle cap. Could this be the treasure? Or just another trap? Heavy sound of water rushing into a tunnel... Not again!" }
    ],
    questRadioMap: {
        q12: 'r5',
        q13: 'r6',
        q14: 'r7',
        q15: 'r8',
        q16: 'r9',
        q17: 'r10'
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
            ingredients: [{ type: 'maritimeMetal', amount: 2 }],
            output: { item: 'Bluenose Bayonet', qty: 1 }
        },
        {
            id: 'r2',
            name: 'TRAPPER\'S PLATE',
            desc: 'High-resistance armor that makes the wearer immune to the Red Mud agility penalty.',
            ingredients: [{ type: 'maritimeMetal', amount: 4 }, { type: 'plaidScraps', amount: 2 }],
            output: { item: 'Trapper\'s Plate', qty: 1 }
        },
        {
            id: 'r3',
            name: 'PROPANE POPPER',
            desc: 'A makeshift grenade that causes a massive fire AOE, perfect for clearing out swarms.',
            ingredients: [{ type: 'propaneTank', amount: 1 }, { type: 'syntheticSap', amount: 2 }],
            output: { item: 'Propane Popper', qty: 1 }
        },
        {
            id: 'r4',
            name: 'DONAIR-DAB KIT',
            desc: 'A powerful healing item (50% HP) but adds +10 RADS unless you have LEAD BELLY perk.',
            ingredients: [{ type: 'radMeat', amount: 1 }, { type: 'spices', amount: 1 }, { type: 'cleanWater', amount: 1 }],
            output: { item: 'Donair-Dab Kit', qty: 1 }
        },
        {
            id: 'r5',
            name: 'STIMPAK',
            desc: 'Restores 4 HP.',
            ingredients: [{ type: 'syntheticSap', amount: 1 }],
            output: { item: 'Stimpak', qty: 1 }
        },
        {
            id: 'r6',
            name: 'RAD-AWAY',
            desc: 'Removes 2 Rads.',
            ingredients: [{ type: 'syntheticSap', amount: 2 }],
            output: { item: 'Rad-Away', qty: 1 }
        },
        {
            id: 'r7',
            name: 'PEGGY\'S COVE CLEATS',
            desc: 'Studded shoreline boots. +1 Agility and +1 Hardiness when crafted (one-time).',
            ingredients: [{ type: 'maritimeMetal', amount: 2 }, { type: 'plaidScraps', amount: 1 }],
            output: { item: 'Peggy\'s Cove Cleats', qty: 1 }
        },
        {
            id: 'r8',
            name: 'BASIN FOG LENS',
            desc: 'A salvaged monocle tuned for coastal haze. +1 Perception when crafted (one-time).',
            ingredients: [{ type: 'hubCircuitry', amount: 1 }, { type: 'cleanWater', amount: 1 }],
            output: { item: 'Basin Fog Lens', qty: 1 }
        },
        {
            id: 'r9',
            name: 'APPLE-CORE SASH',
            desc: 'A Valley propaganda sash that boosts confidence. +1 Charm and +1 Politeness when crafted (one-time).',
            ingredients: [{ type: 'plaidScraps', amount: 2 }, { type: 'spices', amount: 1 }],
            output: { item: 'Apple-Core Sash', qty: 1 }
        }
    ],
    quarterUpgrades: [
        {
            id: 'qupg1',
            name: 'STRUCTURAL REINFORCEMENT',
            desc: 'Clothespins and binder clips reinforce tent walls against Room-Draft Rad-storms.',
            tier: 1,
            cost: 50,
            stat: 'hardiness',
            statBoost: 1,
            effect: 'Vault walls are now taut and resistant to radiation storms.'
        },
        {
            id: 'qupg2',
            name: 'TACTICAL LUMENS',
            desc: 'Battery-powered fairy lights illuminate the Vault at night.',
            tier: 1,
            cost: 75,
            stat: 'perception',
            statBoost: 1,
            effect: 'Lights prevent stubbed toes and improve nighttime visibility.'
        },
        {
            id: 'qupg3',
            name: 'SOFT-FLOOR PROTOCOL',
            desc: 'Extra yoga mats and rugs create cushioned flooring.',
            tier: 1,
            cost: 100,
            stat: null,
            hpRecovery: 'full',
            effect: 'Sleeping in the Vault now fully restores Health.'
        },
        {
            id: 'qupg4',
            name: 'SALVAGED SUPPLY BIN',
            desc: 'A plastic bin or cardboard crate inside the Vault for storage.',
            tier: 1,
            cost: 60,
            stat: null,
            inventorySlots: 3,
            effect: 'Store up to 3 extra pieces of scrap without carry weight penalties.'
        },
        {
            id: 'qupg5',
            name: 'DELTA MASCOT POSTER',
            desc: 'A drawing or photo of the Company mascot pinned to the Vault wall.',
            tier: 1,
            cost: 45,
            stat: 'charm',
            statBoost: 1,
            effect: 'Familiar face boosts morale and negotiation with factions.'
        },
        {
            id: 'qupg6',
            name: 'AIR-LOCK SEALANT',
            desc: 'Duct tape and masking tape seal the blanket fort seams.',
            tier: 1,
            cost: 40,
            stat: null,
            specialEffect: 'skeeterImmunity',
            effect: 'Immune to Rad-Skeeter Swarm encounters while inside the Vault.'
        },
        {
            id: 'qupg7',
            name: 'RATION DISPENSER',
            desc: 'A dedicated bowl or container for session snacks inside the Vault.',
            tier: 1,
            cost: 80,
            stat: null,
            specialEffect: 'fortifiedRecovery',
            effect: '+1 Hardiness for the duration of the next Wasteland Encounter.'
        },
        {
            id: 'qupg8',
            name: 'SCRAP-COMMS LINK',
            desc: 'Tin can phone, toy walkie-talkie, or colored string between Vaults.',
            tier: 1,
            cost: 100,
            stat: null,
            specialEffect: 'assistBonus',
            effect: 'Once per session, call the other survivor for +1 to any C.H.A.P.P.Y. roll.'
        }
    ],
    trades: []
};

function scheduleAutoSave() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
        gameState.version = GAME_STATE_VERSION;
        fs.writeFile(SAVE_FILE_PATH, JSON.stringify(gameState, null, 2), 'utf8', (error) => {
            if (error) {
                console.error('Auto-save failed:', error.message);
            }
        });
    }, SAVE_DEBOUNCE_MS);
}

function migrateGameState(loadedState) {
    if (!loadedState) return null;
    
    const savedVersion = loadedState.version || 1;
    
    // Version 1 to 2: Add any new fields that didn't exist before
    if (savedVersion < 2) {
        // Ensure all players have required fields
        if (loadedState.players) {
            Object.entries(loadedState.players).forEach(([playerName, playerData]) => {
                ensurePlayerProgressFields(playerData);
            });
        }
    }
    
    // Always update version to current
    loadedState.version = GAME_STATE_VERSION;
    
    return loadedState;
}

function loadGameStateFromDisk() {
    if (!fs.existsSync(SAVE_FILE_PATH)) {
        console.log('No existing save file found; starting with fresh game state.');
        return;
    }

    try {
        const fileContent = fs.readFileSync(SAVE_FILE_PATH, 'utf8');
        const loadedState = JSON.parse(fileContent);
        
        if (loadedState && typeof loadedState === 'object' && loadedState.players) {
            // Migrate old save format to new format
            const migratedState = migrateGameState(loadedState);
            if (migratedState) {
                gameState = migratedState;
                const oldVer = loadedState.version || 1;
                console.log(`Loaded saved game state from disk (version ${oldVer} -> ${GAME_STATE_VERSION}).`);
            }
        }
    } catch (error) {
        console.error('Failed to load saved game state:', error.message);
    }
}

function flushSaveOnExit() {
    try {
        gameState.version = GAME_STATE_VERSION;
        fs.writeFileSync(SAVE_FILE_PATH, JSON.stringify(gameState, null, 2), 'utf8');
        console.log('Game state saved on server shutdown.');
    } catch (error) {
        console.error('Final save failed:', error.message);
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getXpRequiredForLevel(level) {
    const safeLevel = Math.max(1, Number(level) || 1);
    return 5 + ((safeLevel - 1) * 3);
}

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
    playerData.hp = clamp((playerData.hp || 0) + hpDelta, 0, playerData.maxHp || 10);
    playerData.rads = clamp((playerData.rads || 0) + radDelta, 0, 10);
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
    const outcomes = [
        { id: 'lose_hp', text: 'LOSE 2 HEALTH', apply: (p) => { p.hp = clamp((p.hp || 0) - 2, 0, p.maxHp || 10); } },
        { id: 'gain_rads_2', text: 'GAIN 2 RADS', apply: (p) => { p.rads = clamp((p.rads || 0) + 2, 0, 10); } },
        { id: 'gain_rads_4', text: 'GAIN 4 RADS', apply: (p) => { p.rads = clamp((p.rads || 0) + 4, 0, 10); } },
        { id: 'gain_tabs_2', text: 'GAIN 2 TABS', apply: (p) => { p.tabs = (p.tabs || 0) + 2; } },
        { id: 'gain_resource', text: 'GAIN RANDOM RESOURCE', apply: (p) => {
            const scrapType = getRandomScrapType(player);
            if (scrapType) {
                p.scrap[scrapType] = (p.scrap[scrapType] || 0) + 1;
                return `${scrapType} +1`;
            }
            return 'NO SCRAP AVAILABLE';
        } },
        { id: 'gain_stimpak', text: 'GAIN STIMPAK', apply: (p) => { addInventoryItem(player, 'Stimpak'); } },
        { id: 'gain_radaway', text: 'GAIN RAD-AWAY', apply: (p) => { addInventoryItem(player, 'Rad-Away'); } }
    ];

    const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
    const extra = outcome.apply(gameState.players[player]);
    return {
        id: outcome.id,
        text: outcome.text,
        extra: extra || null
    };
}

loadGameStateFromDisk();

process.on('SIGINT', () => {
    flushSaveOnExit();
    process.exit(0);
});

process.on('SIGTERM', () => {
    flushSaveOnExit();
    process.exit(0);
});

// --- GM ENDPOINTS ---

// GET game state for GM dashboard
app.get('/api/game-state', (req, res) => {
    Object.values(gameState.players).forEach(ensurePlayerProgressFields);
    res.json(gameState);
});

// Update player stat
app.post('/api/player/:player/stat/:stat', (req, res) => {
    const { player, stat } = req.params;
    const { value } = req.body;
    if (gameState.players[player] && gameState.players[player][stat] !== undefined) {
        gameState.players[player][stat] = value;
        scheduleAutoSave();
        res.json({ success: true, message: `Updated ${player} ${stat}` });
    } else {
        res.status(404).json({ error: 'Player or stat not found' });
    }
});

// Update player stats object (for character creation)
app.post('/api/player/:player/stats', (req, res) => {
    const { player } = req.params;
    const { stats } = req.body;
    if (gameState.players[player] && stats && typeof stats === 'object') {
        gameState.players[player].stats = stats;
        scheduleAutoSave();
        res.json({ success: true, message: `Updated ${player} stats`, stats: stats });
    } else {
        res.status(400).json({ error: 'Invalid stats object' });
    }
});

// Send quest to player
app.post('/api/player/:player/quest', (req, res) => {
    const { player } = req.params;
    const { questId } = req.body;
    if (gameState.players[player] && questId) {
        const quest = gameState.quests.find(q => q.id === questId);
        if (quest && !gameState.players[player].activeQuests.includes(questId)) {
            gameState.players[player].activeQuests.push(questId);
            
            // Auto-send corresponding radio signal if mapped
            const radioId = gameState.questRadioMap[questId];
            if (radioId) {
                gameState.players[player].activeRadio = radioId;
                gameState.players[player].activeRadioData = null;
            }
            
            scheduleAutoSave();
            res.json({ success: true, message: `Quest sent to ${player}` });
        } else {
            res.status(400).json({ error: 'Quest already active or not found' });
        }
    }
});

// Send radio signal to player
app.post('/api/player/:player/radio', (req, res) => {
    const { player } = req.params;
    const { radioId } = req.body;
    if (gameState.players[player]) {
        gameState.players[player].activeRadio = radioId;
        gameState.players[player].activeRadioData = null;
        scheduleAutoSave();
        res.json({ success: true, message: `Radio signal sent to ${player}` });
    }
});

// Send custom radio message to player
app.post('/api/player/:player/radio-message', (req, res) => {
    const { player } = req.params;
    const { message } = req.body;
    if (!gameState.players[player]) {
        return res.status(404).json({ error: 'Player not found' });
    }
    if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message cannot be empty' });
    }
    
    // Create a custom radio signal
    const customSignal = {
        id: `custom_${Date.now()}`,
        title: 'OVERSEER TRANSMISSION',
        frequency: '88.5 FM',
        text: message.trim(),
        type: 'custom'
    };
    
    gameState.players[player].activeRadio = customSignal.id;
    gameState.players[player].activeRadioData = customSignal;
    scheduleAutoSave();
    res.json({ success: true, message: 'Custom signal sent', signal: customSignal });
});

// Modify player scrap/inventory
app.post('/api/player/:player/scrap/:type', (req, res) => {
    const { player, type } = req.params;
    const { amount } = req.body;
    if (gameState.players[player] && gameState.players[player].scrap[type] !== undefined) {
        gameState.players[player].scrap[type] += amount;
        scheduleAutoSave();
        res.json({ success: true, amount: gameState.players[player].scrap[type] });
    }
});

// Grant multiple scrap items at once
app.post('/api/player/:player/scrap/multi', (req, res) => {
    const { player } = req.params;
    const { scrapMap } = req.body;
    
    if (gameState.players[player]) {
        const playerScrap = gameState.players[player].scrap;
        let totalGranted = 0;
        
        Object.entries(scrapMap).forEach(([type, amount]) => {
            if (playerScrap[type] !== undefined && amount > 0) {
                playerScrap[type] += amount;
                totalGranted += amount;
            }
        });
        
        scheduleAutoSave();
        res.json({ success: true, totalGranted, scrap: playerScrap });
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// Complete quest for player
app.post('/api/player/:player/complete-quest', (req, res) => {
    const { player } = req.params;
    const { questId } = req.body;
    const playerData = gameState.players[player];
    if (playerData) {
        ensurePlayerProgressFields(playerData);
        const quest = gameState.quests.find(q => q.id === questId);
        if (quest) {
            playerData.activeQuests = playerData.activeQuests.filter(q => q !== questId);
            playerData.completedQuests.push(questId);
            const tabsReward = quest.rewardTabs || 0;
            const xpReward = quest.xp || 0;
            playerData.tabs += tabsReward;
            playerData.xp += xpReward;

            let levelsGained = 0;
            let xpNeeded = getXpRequiredForLevel(playerData.level);
            while (playerData.xp >= xpNeeded) {
                playerData.xp -= xpNeeded;
                playerData.level += 1;
                levelsGained += 1;
                xpNeeded = getXpRequiredForLevel(playerData.level);
            }

            if (quest.rewardScrap) {
                Object.entries(quest.rewardScrap).forEach(([type, amount]) => {
                    if (playerData.scrap[type] === undefined) {
                        playerData.scrap[type] = 0;
                    }
                    playerData.scrap[type] += amount;
                });
            }
            playerData.pendingPerks = (playerData.pendingPerks || 0) + levelsGained;
            playerData.xpToNext = getXpRequiredForLevel(playerData.level);
            scheduleAutoSave();
            res.json({ success: true, message: `${player} completed ${quest.title}` });
        }
    }
});

// --- PLAYER ENDPOINTS ---

// GET player data
app.get('/api/player/:player', (req, res) => {
    const { player } = req.params;
    if (gameState.players[player]) {
        ensurePlayerProgressFields(gameState.players[player]);
        res.json(gameState.players[player]);
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// GET all quests
app.get('/api/quests', (req, res) => {
    res.json(gameState.quests);
});

// GET random household quest
app.get('/api/random-quest', (req, res) => {
    if (gameState.randomQuests && gameState.randomQuests.length > 0) {
        const randomQuest = gameState.randomQuests[Math.floor(Math.random() * gameState.randomQuests.length)];
        res.json(randomQuest);
    } else {
        res.status(404).json({ error: 'No random quests available' });
    }
});

// Complete random household task for player
app.post('/api/player/:player/complete-random-quest', (req, res) => {
    const { player } = req.params;
    const { questId } = req.body;
    const playerData = gameState.players[player];

    if (!playerData) {
        return res.status(404).json({ error: 'Player not found' });
    }

    const quest = gameState.randomQuests.find(q => q.id === questId);
    if (!quest) {
        return res.status(404).json({ error: 'Random task not found' });
    }

    ensurePlayerProgressFields(playerData);

    const tabsReward = quest.reward || 0;
    const xpReward = quest.xp || 0;
    playerData.tabs += tabsReward;
    playerData.xp += xpReward;

    let levelsGained = 0;
    let xpNeeded = getXpRequiredForLevel(playerData.level);
    while (playerData.xp >= xpNeeded) {
        playerData.xp -= xpNeeded;
        playerData.level += 1;
        levelsGained += 1;
        xpNeeded = getXpRequiredForLevel(playerData.level);
    }

    playerData.pendingPerks = (playerData.pendingPerks || 0) + levelsGained;
    playerData.xpToNext = getXpRequiredForLevel(playerData.level);

    scheduleAutoSave();

    res.json({
        success: true,
        message: `${player} completed ${quest.title}`,
        reward: {
            tabs: tabsReward,
            xp: xpReward,
            levelsGained
        }
    });
});

// GET all radio signals
app.get('/api/radio', (req, res) => {
    const allSignals = [...(gameState.radioSignals || []), ...(gameState.broadcastSignals || [])];
    res.json(allSignals);
});

// GET all perks
app.get('/api/perks', (req, res) => {
    res.json(gameState.perks);
});

// GET all recipes
app.get('/api/recipes', (req, res) => {
    res.json(gameState.recipes);
});

// GET player perks
app.get('/api/player/:player/perks', (req, res) => {
    const { player } = req.params;
    if (gameState.players[player]) {
        const playerPerks = gameState.players[player].unlockedPerks.map(perkId => 
            gameState.perks.find(p => p.id === perkId)
        ).filter(p => p);
        res.json(playerPerks);
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// Add perk to player
app.post('/api/player/:player/perk/:perkId', (req, res) => {
    const { player, perkId } = req.params;
    if (gameState.players[player] && gameState.perks.find(p => p.id === perkId)) {
        if ((gameState.players[player].pendingPerks || 0) <= 0) {
            return res.status(400).json({ error: 'No perk selections available' });
        }
        if (!gameState.players[player].unlockedPerks.includes(perkId)) {
            gameState.players[player].unlockedPerks.push(perkId);
            gameState.players[player].pendingPerks -= 1;
            scheduleAutoSave();
            res.json({ success: true, message: `Perk added to ${player}` });
        } else {
            res.status(400).json({ error: 'Perk already unlocked' });
        }
    } else {
        res.status(404).json({ error: 'Player or perk not found' });
    }
});

// Remove perk from player
app.delete('/api/player/:player/perk/:perkId', (req, res) => {
    const { player, perkId } = req.params;
    if (gameState.players[player]) {
        gameState.players[player].unlockedPerks = gameState.players[player].unlockedPerks.filter(p => p !== perkId);
        scheduleAutoSave();
        res.json({ success: true, message: `Perk removed from ${player}` });
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// Apply a status effect to a player
app.post('/api/player/:player/effect/:effectId', (req, res) => {
    const { player, effectId } = req.params;
    const playerData = gameState.players[player];
    const effect = gameState.statusEffects.find(e => e.id === effectId);
    
    if (!playerData) {
        return res.status(404).json({ error: 'Player not found' });
    }
    if (!effect) {
        return res.status(404).json({ error: 'Effect not found' });
    }
    
    // Apply effect to player (checked for existing effects to avoid duplicates)
    if (!playerData.activeEffects.includes(effectId)) {
        playerData.activeEffects.push(effectId);
        
        // Apply stat modifications if any
        if (effect.effects) {
            Object.entries(effect.effects).forEach(([stat, value]) => {
                if (stat === 'hp' && typeof value === 'number') {
                    playerData.hp = Math.max(0, playerData.hp + value);
                } else if (playerData.stats && playerData.stats[stat] !== undefined) {
                    playerData.stats[stat] += value;
                }
            });
        }
        
        scheduleAutoSave();
        res.json({ success: true, message: `Effect "${effect.name}" applied to ${player}`, effect });
    } else {
        res.status(400).json({ error: 'Player already has this effect' });
    }
});

// Remove status effect from player
app.delete('/api/player/:player/effect/:effectId', (req, res) => {
    const { player, effectId } = req.params;
    const effect = gameState.statusEffects.find(e => e.id === effectId);
    
    if (!gameState.players[player]) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    gameState.players[player].activeEffects = gameState.players[player].activeEffects.filter(e => e !== effectId);
    
    // Reverse stat modifications if any
    if (effect && effect.effects) {
        Object.entries(effect.effects).forEach(([stat, value]) => {
            if (stat === 'hp' && typeof value === 'number') {
                gameState.players[player].hp = Math.max(0, gameState.players[player].hp - value);
            } else if (gameState.players[player].stats && gameState.players[player].stats[stat] !== undefined) {
                gameState.players[player].stats[stat] -= value;
            }
        });
    }
    
    scheduleAutoSave();
    res.json({ success: true, message: `Effect removed from ${player}` });
});

// Craft an item
app.post('/api/player/:player/craft/:recipeId', (req, res) => {
    const { player, recipeId } = req.params;
    if (!gameState.players[player]) {
        return res.status(404).json({ error: 'Player not found' });
    }
    const playerData = gameState.players[player];
    if (!Array.isArray(playerData.craftedGear)) {
        playerData.craftedGear = [];
    }
    
    const recipe = gameState.recipes.find(r => r.id === recipeId);
    if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
    }

    const oneTimeGearEffects = {
        r1: { stats: { agility: 1 }, text: 'Agility +1 (Bluenose Bayonet equipped).' },
        r2: { stats: { hardiness: 1 }, maxHp: 2, hp: 2, text: 'Hardiness +1 and Max HP +2 (Trapper\'s Plate equipped).' },
        r7: { stats: { agility: 1, hardiness: 1 }, text: 'Agility +1 and Hardiness +1 (Peggy\'s Cove Cleats equipped).' },
        r8: { stats: { perception: 1 }, text: 'Perception +1 (Basin Fog Lens equipped).' },
        r9: { stats: { charm: 1, politeness: 1 }, text: 'Charm +1 and Politeness +1 (Apple-Core Sash equipped).' }
    };

    if (oneTimeGearEffects[recipe.id] && playerData.craftedGear.includes(recipe.id)) {
        return res.status(400).json({ error: `${recipe.name} is already crafted and equipped.` });
    }
    
    // Check if player has all required ingredients
    const playerScrap = playerData.scrap;
    for (let ingredient of recipe.ingredients) {
        if (ingredient.type === 'propaneTank' || ingredient.type === 'syntheticSap' || 
            ingredient.type === 'maritimeMetal' || ingredient.type === 'plaidScraps' ||
            ingredient.type === 'radMeat' || ingredient.type === 'spices' || 
            ingredient.type === 'cleanWater' || ingredient.type === 'hubCircuitry') {
            if (!playerScrap[ingredient.type] || playerScrap[ingredient.type] < ingredient.amount) {
                return res.status(400).json({ error: `Not enough ${ingredient.type}` });
            }
        }
    }
    
    // Consume ingredients
    for (let ingredient of recipe.ingredients) {
        if (ingredient.type !== 'inventory') {
            playerScrap[ingredient.type] -= ingredient.amount;
        }
    }

    if (oneTimeGearEffects[recipe.id]) {
        const effect = oneTimeGearEffects[recipe.id];

        if (effect.stats) {
            Object.entries(effect.stats).forEach(([stat, value]) => {
                if (playerData.stats && playerData.stats[stat] !== undefined) {
                    playerData.stats[stat] += value;
                }
            });
        }

        if (effect.maxHp) {
            playerData.maxHp = (playerData.maxHp || 10) + effect.maxHp;
        }

        if (effect.hp) {
            playerData.hp = clamp((playerData.hp || 0) + effect.hp, 0, playerData.maxHp || 10);
        }

        playerData.craftedGear.push(recipe.id);
        scheduleAutoSave();

        return res.json({
            success: true,
            message: `Crafted ${recipe.name}! ${effect.text}`,
            effect: effect
        });
    }

    if (recipe.id === 'r3') {
        playerData.tabs = (playerData.tabs || 0) + 15;
        scheduleAutoSave();

        return res.json({
            success: true,
            message: 'Crafted Propane Popper! Salvage blast recovered +15 Tabs.',
            effect: { tabsGained: 15, tabs: playerData.tabs }
        });
    }

    if (recipe.id === 'r4') {
        const hasLeadBelly = (playerData.unlockedPerks || []).includes('p6');
        const healAmount = Math.max(1, Math.ceil((playerData.maxHp || 10) * 0.5));
        const beforeHp = playerData.hp || 0;
        const beforeRads = playerData.rads || 0;

        playerData.hp = clamp(beforeHp + healAmount, 0, playerData.maxHp || 10);
        if (!hasLeadBelly) {
            playerData.rads = clamp(beforeRads + 10, 0, 10);
        }

        scheduleAutoSave();

        return res.json({
            success: true,
            message: hasLeadBelly
                ? 'Crafted Donair-Dab Kit! Restored HP with no RAD gain (Lead Belly).'
                : 'Crafted Donair-Dab Kit! Restored HP and gained RADS.',
            effect: {
                hpRestored: playerData.hp - beforeHp,
                radsAdded: hasLeadBelly ? 0 : (playerData.rads - beforeRads),
                hp: playerData.hp,
                rads: playerData.rads
            }
        });
    }

    if (recipe.id === 'r5') {
        const healAmount = 4;
        const beforeHp = playerData.hp || 0;
        const maxHp = playerData.maxHp || 10;
        playerData.hp = clamp(beforeHp + healAmount, 0, maxHp);
        const healed = playerData.hp - beforeHp;
        scheduleAutoSave();

        return res.json({
            success: true,
            message: `Crafted STIMPAK! Restored ${healed} HP.`,
            effect: { hpRestored: healed, hp: playerData.hp, maxHp: maxHp }
        });
    }

    if (recipe.id === 'r6') {
        const removeRads = 2;
        const beforeRads = playerData.rads || 0;
        playerData.rads = clamp(beforeRads - removeRads, 0, 10);
        const reduced = beforeRads - playerData.rads;
        scheduleAutoSave();

        return res.json({
            success: true,
            message: `Crafted RAD-AWAY! Removed ${reduced} RADS.`,
            effect: { radsRemoved: reduced, rads: playerData.rads }
        });
    }

    return res.status(400).json({ error: 'No craft effect configured for this recipe.' });
});

// GET all quarters upgrades
app.get('/api/quarters-shop', (req, res) => {
    res.json(gameState.quarterUpgrades);
});

// GET player's purchased quarters upgrades
app.get('/api/player/:player/quarters', (req, res) => {
    const { player } = req.params;
    if (gameState.players[player]) {
        const playerUpgrades = gameState.players[player].purchasedUpgrades.map(upgradeId => 
            gameState.quarterUpgrades.find(u => u.id === upgradeId)
        ).filter(u => u);
        res.json(playerUpgrades);
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// Purchase a quarters upgrade
app.post('/api/player/:player/quarters/:upgradeId', (req, res) => {
    const { player, upgradeId } = req.params;
    if (!gameState.players[player]) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    const upgrade = gameState.quarterUpgrades.find(u => u.id === upgradeId);
    if (!upgrade) {
        return res.status(404).json({ error: 'Upgrade not found' });
    }
    
    // Check if already purchased
    if (gameState.players[player].purchasedUpgrades.includes(upgradeId)) {
        return res.status(400).json({ error: 'Upgrade already purchased' });
    }
    
    // Check if player has enough tabs
    if (gameState.players[player].tabs < upgrade.cost) {
        return res.status(400).json({ error: `Need ${upgrade.cost} tabs, only have ${gameState.players[player].tabs}` });
    }
    
    // Deduct tabs and purchase
    gameState.players[player].tabs -= upgrade.cost;
    gameState.players[player].purchasedUpgrades.push(upgradeId);
    
    // Apply stat boosts if applicable
    if (upgrade.stat && upgrade.statBoost) {
        gameState.players[player].stats[upgrade.stat] += upgrade.statBoost;
    }
    scheduleAutoSave();
    
    res.json({ 
        success: true, 
        message: `Purchased ${upgrade.name}!`,
        upgrade: upgrade,
        remainingTabs: gameState.players[player].tabs
    });
});

// GET all broadcast signals
app.get('/api/broadcast-signals', (req, res) => {
    res.json(gameState.broadcastSignals);
});

// Send random broadcast to both players
app.post('/api/broadcast/random', (req, res) => {
    if (!gameState.broadcastSignals || gameState.broadcastSignals.length === 0) {
        return res.status(400).json({ error: 'No broadcast signals available' });
    }
    
    const randomSignal = gameState.broadcastSignals[Math.floor(Math.random() * gameState.broadcastSignals.length)];
    
    // Send to both players
    for (let player in gameState.players) {
        gameState.players[player].activeRadio = randomSignal.id;
        gameState.players[player].activeRadioData = null;
    }
    
    scheduleAutoSave();
    res.json({ success: true, message: 'Broadcast sent to all players', signal: randomSignal });
});

// Send random encounter to both players with D20 outcomes
app.post('/api/encounter/random', (req, res) => {
    if (!gameState.randomEncounters || gameState.randomEncounters.length === 0) {
        return res.status(400).json({ error: 'No random encounters available' });
    }

    const encounter = gameState.randomEncounters[Math.floor(Math.random() * gameState.randomEncounters.length)];

    for (let player in gameState.players) {
        gameState.players[player].activeRadio = null;
        gameState.players[player].activeRadioData = {
            title: encounter.title,
            text: encounter.text,
            encounterId: encounter.id,
            requiresResolve: true
        };
    }

    scheduleAutoSave();
    res.json({ success: true, message: 'Encounter sent to all players', encounter: encounter });
});

// Resolve a pending encounter for a player
app.post('/api/player/:player/encounter/resolve', (req, res) => {
    const { player } = req.params;
    const playerData = gameState.players[player];
    if (!playerData || !playerData.activeRadioData || !playerData.activeRadioData.requiresResolve) {
        return res.status(400).json({ error: 'No encounter to resolve' });
    }

    const outcome = applyEncounterOutcome(player);
    const extraText = outcome.extra ? ` (${outcome.extra})` : '';
    playerData.activeRadioData.text = `${playerData.activeRadioData.text}\n\nRESOLVED: ${outcome.text}${extraText}`;
    playerData.activeRadioData.requiresResolve = false;

    scheduleAutoSave();
    res.json({ success: true, outcome: outcome, radio: playerData.activeRadioData });
});

// Get trade offers

// --- TRADING SYSTEM ---

// GET all pending trades
app.get('/api/trades/pending', (req, res) => {
    res.json(gameState.trades);
});

// GET trades for a specific player (both sent and received)
app.get('/api/player/:player/trades', (req, res) => {
    const { player } = req.params;
    const playerTrades = gameState.trades.filter(t => t.from === player || t.to === player);
    res.json(playerTrades);
});

// Initiate a trade offer
app.post('/api/player/:player/trade/offer', (req, res) => {
    const { player } = req.params;
    const { toPlayer, offeringScrap, requestingScrap } = req.body;
    
    if (!gameState.players[player] || !gameState.players[toPlayer]) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    if (player === toPlayer) {
        return res.status(400).json({ error: 'Cannot trade with yourself' });
    }
    
    // Verify player has offering scrap
    for (let [scrapType, amount] of Object.entries(offeringScrap)) {
        if (!gameState.players[player].scrap[scrapType] || gameState.players[player].scrap[scrapType] < amount) {
            return res.status(400).json({ error: `Not enough ${scrapType}` });
        }
    }
    
    // Create trade offer
    const trade = {
        id: `trade-${Date.now()}`,
        from: player,
        to: toPlayer,
        offeringScrap: offeringScrap,
        requestingScrap: requestingScrap,
        status: 'pending',
        createdAt: Date.now()
    };
    
    gameState.trades.push(trade);
    scheduleAutoSave();
    
    res.json({ success: true, message: `Trade offer sent to ${toPlayer}!`, trade: trade });
});

// Accept a trade offer
app.post('/api/trade/:tradeId/accept', (req, res) => {
    const { tradeId } = req.params;
    const { player } = req.body;
    
    const trade = gameState.trades.find(t => t.id === tradeId);
    if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
    }
    
    if (trade.to !== player) {
        return res.status(400).json({ error: 'You cannot accept this trade' });
    }
    
    if (trade.status !== 'pending') {
        return res.status(400).json({ error: 'Trade is no longer pending' });
    }
    
    // Verify receiving player has requesting scrap
    for (let [scrapType, amount] of Object.entries(trade.requestingScrap)) {
        if (!gameState.players[player].scrap[scrapType] || gameState.players[player].scrap[scrapType] < amount) {
            return res.status(400).json({ error: `Not enough ${scrapType} to complete trade` });
        }
    }
    
    // Verify offering player still has offering scrap
    for (let [scrapType, amount] of Object.entries(trade.offeringScrap)) {
        if (!gameState.players[trade.from].scrap[scrapType] || gameState.players[trade.from].scrap[scrapType] < amount) {
            return res.status(400).json({ error: `Offering player no longer has required scrap` });
        }
    }
    
    // Transfer scrap - FROM gives to TO
    for (let [scrapType, amount] of Object.entries(trade.offeringScrap)) {
        gameState.players[trade.from].scrap[scrapType] -= amount;
        gameState.players[player].scrap[scrapType] += amount;
    }
    
    // Transfer scrap - TO gives to FROM
    for (let [scrapType, amount] of Object.entries(trade.requestingScrap)) {
        gameState.players[player].scrap[scrapType] -= amount;
        gameState.players[trade.from].scrap[scrapType] += amount;
    }
    
    trade.status = 'accepted';
    trade.acceptedAt = Date.now();
    scheduleAutoSave();
    
    res.json({ success: true, message: 'Trade accepted!', trade: trade });
});

// Reject a trade offer
app.post('/api/trade/:tradeId/reject', (req, res) => {
    const { tradeId } = req.params;
    const { player } = req.body;
    
    const trade = gameState.trades.find(t => t.id === tradeId);
    if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
    }
    
    if (trade.to !== player) {
        return res.status(400).json({ error: 'You cannot reject this trade' });
    }
    
    if (trade.status !== 'pending') {
        return res.status(400).json({ error: 'Trade is no longer pending' });
    }
    
    trade.status = 'rejected';
    trade.rejectedAt = Date.now();
    scheduleAutoSave();
    
    res.json({ success: true, message: 'Trade rejected', trade: trade });
});

// Reset all game data to initial state
app.post('/api/reset', (req, res) => {
    // Re-initialize game state to default
    gameState = {
        players: {
            logan: {
                name: 'Logan',
                level: 1,
                xp: 0,
                hp: 10,
                maxHp: 10,
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
                activeEffects: []
            },
            rylyn: {
                name: 'Rylyn',
                level: 1,
                xp: 0,
                hp: 10,
                maxHp: 10,
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
                activeEffects: []
            }
        },
        perks: [
            { id: 'p1', name: "IRON CALVES", desc: "Climbing Jacob's Ladder no longer causes HP loss.", tier: 1 },
            { id: 'p2', name: "AQUA-BLUENOSER", desc: "Immune to Radiation while at the shoreline.", tier: 1 },
            { id: 'p3', name: "THRIFTY TOWNIE", desc: "Gain 2 extra Pop Tabs from every quest.", tier: 2 },
            { id: 'p4', name: "DONAIR DIGESTION", desc: "Healing items (snacks) restore double HP.", tier: 1 },
            { id: 'p5', name: "SCRAPPER", desc: "50% chance to find double scrap items.", tier: 2 },
            { id: 'p6', name: "LEAD BELLY", desc: "Eating 'Red Mud' food causes 0 Radiation.", tier: 1 },
            { id: 'p7', name: "WASTELAND WAND", desc: "+1 Agility on trails and outdoor areas.", tier: 2 },
            { id: 'p8', name: "SCAVENGER'S EYE", desc: "+1 Perception for finding hidden items.", tier: 3 },
            { id: 'p9', name: "PLAID PRIDE", desc: "+2 Charisma with faction members.", tier: 2 },
            { id: 'p10', name: "QUICK-HANDS", desc: "+10% attack speed with melee weapons.", tier: 3 }
        ],
        statusEffects: [
            {
                id: 'se1',
                name: "DONAIR SWEATS",
                desc: "You smell so strongly of garlic and spiced beef that you can't sneak, and people don't want to talk to you.",
                trigger: "Consuming low-quality Mystery Meat",
                type: 'debuff',
                effects: { agility: -1, politeness: -1 },
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
                durationMinutes: 15
            },
            {
                id: 'se4',
                name: "BLACK ROCK SLIP",
                desc: "You didn't stay off the black rocks at Peggy's Cove. The Atlantic Ocean humbled you.",
                trigger: "Rolling a 1 near the coastline",
                type: 'debuff',
                effects: { hp: -3, hardiness: -1 },
                permanent: true
            },
            {
                id: 'se5',
                name: "OVER-POLITE STANDOFF",
                desc: "A classic Nova Scotian deadlock where nobody wants to be the one to go first.",
                trigger: "Encountering another player at a doorway or loot pile",
                type: 'mutual_debuff',
                effects: { skipNextTurn: true },
                durationTurns: 1
            }
        ],
        quests: [
            { id: 'h1', title: "VAULT: Sanitize Quarters", desc: "Clean your room until no scrap remains on the floor.", category: 'vault', rewardTabs: 10, rewardScrap: { syntheticSap: 1 }, xp: 1 },
            { id: 'h2', title: "VAULT: Nutrient Synthesis", desc: "Assist the Overseer with preparing a family meal.", category: 'vault', rewardTabs: 15, rewardScrap: { cleanWater: 1, spices: 1 }, xp: 1 },
            { id: 'h3', title: "VAULT: Static Discharge", desc: "Fold and put away a basket of clean laundry.", category: 'vault', rewardTabs: 10, rewardScrap: { plaidScraps: 1 }, xp: 1 },
            { id: 'q2', title: "The Great Drain", desc: "Visit Burncoat Head at low tide.", category: 'main', rewardTabs: 20, rewardScrap: { maritimeMetal: 2 }, xp: 1 },
            { id: 'q5', title: "Jacob's Ladder Trial", desc: "Complete the brutal 175 step challenge without falling.", category: 'main', rewardTabs: 45, rewardScrap: { hubCircuitry: 1 }, xp: 2 },
            { id: 'q6', title: "Witches' Cauldron Mystery", desc: "Dive into the radioactive pool and retrieve the pre-war crate.", category: 'main', rewardTabs: 45, rewardScrap: { radMeat: 1, cleanWater: 1 }, xp: 2 },
            { id: 'q11', title: "Battle for the Bazaar", desc: "Defend Masstown Market from Highway 104 Raiders.", category: 'main', rewardTabs: 100, rewardScrap: { maritimeMetal: 2, hubCircuitry: 2 }, xp: 3 },
            { id: 'q12', title: "The Tidal Bore Race", desc: "Gather all Scrap and Supplies and return to safety before the 5-minute tide rush!", category: 'side', rewardTabs: 50, rewardScrap: { maritimeMetal: 1, syntheticSap: 1 }, xp: 2 },
            { id: 'q13', title: "The Plaid Patch-Up", desc: "Find Plaid Scrap and use Synthetic Sap to patch the Vault air-lock before the next Rad-Storm.", category: 'side', rewardTabs: 35, rewardScrap: { plaidScraps: 2, syntheticSap: 1 }, xp: 1 },
            { id: 'q14', title: "Three-Crows Signal Boost", desc: "One player stands at the Highest Peak for 60 seconds while the other tunes the Pip-Boy. Recite the Wasteland Oath!", category: 'side', rewardTabs: 20, rewardScrap: { hubCircuitry: 1 }, xp: 1 },
            { id: 'q15', title: "The Junk-Jet Prototype", desc: "Collect 5 pieces of Scrap from different Biomes and justify each one to the Overseer.", category: 'side', rewardTabs: 60, rewardScrap: { propaneTank: 1, maritimeMetal: 1 }, xp: 2 },
            { id: 'q16', title: "Five Islands Provincial Park (The Great Drain)", desc: "Master the Mud-Slog and survive the Tidal Rush at the Great Drain.", category: 'main', rewardTabs: 55, rewardScrap: { maritimeMetal: 2, cleanWater: 1 }, xp: 2 },
            { id: 'q17', title: "Shubenacadie Wildlife Park (The Beast Pens)", desc: "Scout the perimeter and photograph three Wasteland Creatures without startling them.", category: 'main', rewardTabs: 50, rewardScrap: { radMeat: 1, spices: 1 }, xp: 2 }
        ],
        randomQuests: [
            { id: 'rq1', title: "HOUSE: Tidy the Living Room", desc: "Pick up toys and organize the space.", reward: 5, xp: 1 },
            { id: 'rq2', title: "HOUSE: Wash the Dishes", desc: "Clean and rinse all dishes in the sink.", reward: 5, xp: 1 },
            { id: 'rq3', title: "HOUSE: Make Your Bed", desc: "Pull covers tight and arrange pillows.", reward: 5, xp: 1 },
            { id: 'rq4', title: "HOUSE: Sweep the Kitchen", desc: "Clear crumbs and debris from the floor.", reward: 5, xp: 1 },
            { id: 'rq5', title: "CRAFT: Build a Lego Structure", desc: "Create and complete any Lego model.", reward: 8, xp: 1 },
            { id: 'rq6', title: "CRAFT: Draw or Paint", desc: "Create a piece of art and show it off.", reward: 8, xp: 1 },
            { id: 'rq7', title: "CRAFT: Assemble a Model", desc: "Build something cool from a kit.", reward: 10, xp: 1 },
            { id: 'rq8', title: "SPORT: Play Soccer in the Yard", desc: "Get some exercise kicking the ball.", reward: 8, xp: 1 },
            { id: 'rq9', title: "SPORT: Go for a Bike Ride", desc: "Ride your bike around the neighborhood.", reward: 10, xp: 1 },
            { id: 'rq10', title: "SPORT: Play Catch", desc: "Toss a ball back and forth.", reward: 5, xp: 1 },
            { id: 'rq11', title: "CHORE: Fold Laundry", desc: "Sort and fold clean clothes.", reward: 5, xp: 1 },
            { id: 'rq12', title: "CHORE: Take Out Trash", desc: "Empty the bins and replace bags.", reward: 5, xp: 1 },
            { id: 'rq13', title: "CHORE: Organize Closet", desc: "Sort and arrange your belongings.", reward: 8, xp: 1 }
        ],
        recipes: [
            {
                id: 'r1',
                name: 'BLUENOSE BAYONET',
                desc: 'A reach weapon that deals extra damage to Rad-Skeeters.',
                ingredients: [{ type: 'maritimeMetal', amount: 2 }],
                output: { item: 'Bluenose Bayonet', qty: 1 }
            },
            {
                id: 'r2',
                name: 'TRAPPER\'S PLATE',
                desc: 'High-resistance armor that makes the wearer immune to the Red Mud agility penalty.',
                ingredients: [{ type: 'maritimeMetal', amount: 4 }, { type: 'plaidScraps', amount: 2 }],
                output: { item: 'Trapper\'s Plate', qty: 1 }
            },
            {
                id: 'r3',
                name: 'PROPANE POPPER',
                desc: 'A makeshift grenade that causes a massive fire AOE, perfect for clearing out swarms.',
                ingredients: [{ type: 'propaneTank', amount: 1 }, { type: 'syntheticSap', amount: 2 }],
                output: { item: 'Propane Popper', qty: 1 }
            },
            {
                id: 'r4',
                name: 'DONAIR-DAB KIT',
                desc: 'A powerful healing item (50% HP) but adds +10 RADS unless you have LEAD BELLY perk.',
                ingredients: [{ type: 'radMeat', amount: 1 }, { type: 'spices', amount: 1 }, { type: 'cleanWater', amount: 1 }],
                output: { item: 'Donair-Dab Kit', qty: 1 }
            },
            {
                id: 'r5',
                name: 'STIMPAK',
                desc: 'Restores 4 HP.',
                ingredients: [{ type: 'syntheticSap', amount: 1 }],
                output: { item: 'Stimpak', qty: 1 }
            },
            {
                id: 'r6',
                name: 'RAD-AWAY',
                desc: 'Removes 2 Rads.',
                ingredients: [{ type: 'syntheticSap', amount: 2 }],
                output: { item: 'Rad-Away', qty: 1 }
            },
            {
                id: 'r7',
                name: 'PEGGY\'S COVE CLEATS',
                desc: 'Studded shoreline boots. +1 Agility and +1 Hardiness when crafted (one-time).',
                ingredients: [{ type: 'maritimeMetal', amount: 2 }, { type: 'plaidScraps', amount: 1 }],
                output: { item: 'Peggy\'s Cove Cleats', qty: 1 }
            },
            {
                id: 'r8',
                name: 'BASIN FOG LENS',
                desc: 'A salvaged monocle tuned for coastal haze. +1 Perception when crafted (one-time).',
                ingredients: [{ type: 'hubCircuitry', amount: 1 }, { type: 'cleanWater', amount: 1 }],
                output: { item: 'Basin Fog Lens', qty: 1 }
            },
            {
                id: 'r9',
                name: 'APPLE-CORE SASH',
                desc: 'A Valley propaganda sash that boosts confidence. +1 Charm and +1 Politeness when crafted (one-time).',
                ingredients: [{ type: 'plaidScraps', amount: 2 }, { type: 'spices', amount: 1 }],
                output: { item: 'Apple-Core Sash', qty: 1 }
            }
        ],
        trades: [],
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
            { id: 'r10', title: "BEAST PENS SIGHTING", text: "Movement detected at Shubenacadie Wildlife Park. Rad-Moose and Yao Guai variants confirmed. Scout teams deploy. Biological data required." }
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
            { id: 'b17', title: "THE OAK ISLAND PING", text: "Entry 4,002. We've dug another ten feet. We found a coconut fiber mat and a single pre-war bottle cap. Could this be the treasure? Or just another trap? Heavy sound of water rushing into a tunnel... Not again!" }
        ],
        quarterUpgrades: [
            {
                id: 'qupg1',
                name: 'STRUCTURAL REINFORCEMENT',
                desc: 'Clothespins and binder clips reinforce tent walls against Room-Draft Rad-storms.',
                tier: 1,
                cost: 50,
                stat: 'hardiness',
                statBoost: 1,
                effect: 'Vault walls are now taut and resistant to radiation storms.'
            },
            {
                id: 'qupg2',
                name: 'TACTICAL LUMENS',
                desc: 'Battery-powered fairy lights illuminate the Vault at night.',
                tier: 1,
                cost: 75,
                stat: 'perception',
                statBoost: 1,
                effect: 'Lights prevent stubbed toes and improve nighttime visibility.'
            },
            {
                id: 'qupg3',
                name: 'SOFT-FLOOR PROTOCOL',
                desc: 'Extra yoga mats and rugs create cushioned flooring.',
                tier: 1,
                cost: 100,
                stat: null,
                hpRecovery: 'full',
                effect: 'Sleeping in the Vault now fully restores Health.'
            },
            {
                id: 'qupg4',
                name: 'SALVAGED SUPPLY BIN',
                desc: 'A plastic bin or cardboard crate inside the Vault for storage.',
                tier: 1,
                cost: 60,
                stat: null,
                inventorySlots: 3,
                effect: 'Store up to 3 extra pieces of scrap without carry weight penalties.'
            },
            {
                id: 'qupg5',
                name: 'DELTA MASCOT POSTER',
                desc: 'A drawing or photo of the Company mascot pinned to the Vault wall.',
                tier: 1,
                cost: 45,
                stat: 'charm',
                statBoost: 1,
                effect: 'Familiar face boosts morale and negotiation with factions.'
            },
            {
                id: 'qupg6',
                name: 'AIR-LOCK SEALANT',
                desc: 'Duct tape and masking tape seal the blanket fort seams.',
                tier: 1,
                cost: 40,
                stat: null,
                specialEffect: 'skeeterImmunity',
                effect: 'Immune to Rad-Skeeter Swarm encounters while inside the Vault.'
            },
            {
                id: 'qupg7',
                name: 'RATION DISPENSER',
                desc: 'A dedicated bowl or container for session snacks inside the Vault.',
                tier: 1,
                cost: 80,
                stat: null,
                specialEffect: 'fortifiedRecovery',
                effect: '+1 Hardiness for the duration of the next Wasteland Encounter.'
            },
            {
                id: 'qupg8',
                name: 'SCRAP-COMMS LINK',
                desc: 'Tin can phone, toy walkie-talkie, or colored string between Vaults.',
                tier: 1,
                cost: 100,
                stat: null,
                specialEffect: 'assistBonus',
                effect: 'Once per session, call the other survivor for +1 to any C.H.A.P.P.Y. roll.'
            }
        ],
        trades: [],
        questRadioMap: {
            q12: 'r5',
            q13: 'r6',
            q14: 'r7',
            q15: 'r8',
            q16: 'r9',
            q17: 'r10'
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
            }
        ]
    };
    
    scheduleAutoSave();
    res.json({ success: true, message: 'Game data reset to initial state' });
});

// --- SERVER START ---
loadGameStateFromDisk();

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


// Graceful shutdown handlers to save game state
process.on('SIGINT', () => {
    console.log('\nServer shutting down. Saving game state...');
    flushSaveOnExit();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nServer terminating. Saving game state...');
    flushSaveOnExit();
    process.exit(0);
});
