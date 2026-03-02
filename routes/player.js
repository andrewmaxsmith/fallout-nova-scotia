const EDUCATIONAL_QUESTS_PER_CATEGORY = 8;

const EDUCATIONAL_CATEGORY_DEFINITIONS = {
    reading: { label: 'READING', rewardTabs: 1, rewardXp: 0, wrongPenalty: { hp: 1 } },
    math: { label: 'MATH', rewardTabs: 1, rewardXp: 1, wrongPenalty: { rads: 1 } },
    spelling: { label: 'SPELLING', rewardTabs: 1, rewardXp: 0, wrongPenalty: { hp: 1 } },
    science: { label: 'SCIENCE', rewardTabs: 2, rewardXp: 1, wrongPenalty: { rads: 1 } },
    writing: { label: 'WRITING', rewardTabs: 1, rewardXp: 0, wrongPenalty: { hp: 1 } },
    mapReading: { label: 'MAP READING', rewardTabs: 1, rewardXp: 1, wrongPenalty: { rads: 1 } }
};

const EDUCATIONAL_CATEGORY_ORDER = ['reading', 'math', 'spelling', 'science', 'writing', 'mapReading'];

function shuffleArray(items) {
    const next = [...items];
    for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
}

function createQuestEntry(category, idSuffix, payload) {
    const categoryDef = EDUCATIONAL_CATEGORY_DEFINITIONS[category];
    if (!categoryDef) {
        return null;
    }

    const pairedOptions = (payload.options || []).map((text, index) => ({
        text: String(text),
        isCorrect: index === payload.correctOptionIndex
    }));
    const shuffled = shuffleArray(pairedOptions);
    const correctOptionIndex = shuffled.findIndex(option => option.isCorrect);

    return {
        id: `edu-${category}-${idSuffix}`,
        category,
        categoryLabel: categoryDef.label,
        title: payload.title || `${categoryDef.label} MISSION`,
        question: payload.question,
        options: shuffled.map(option => option.text),
        correctOptionIndex,
        rewardTabs: Number(payload.rewardTabs ?? categoryDef.rewardTabs),
        rewardXp: Number(payload.rewardXp ?? categoryDef.rewardXp),
        wrongPenalty: {
            hp: Number(payload.wrongPenalty?.hp ?? categoryDef.wrongPenalty?.hp ?? 0),
            rads: Number(payload.wrongPenalty?.rads ?? categoryDef.wrongPenalty?.rads ?? 0)
        }
    };
}

function buildEducationalQuestLibrary() {
    const raw = {
        reading: [
            { question: 'Which sentence tells you where something is?', options: ['The cat is under the table.', 'Blue is a color.', 'Jump high now.'], correctOptionIndex: 0 },
            { question: 'Pick the main noun: "The small robot rolled home."', options: ['robot', 'small', 'rolled'], correctOptionIndex: 0 },
            { question: 'Which word is an action in "Birds fly over water"?', options: ['fly', 'birds', 'water'], correctOptionIndex: 0 },
            { question: 'Which sentence is a question?', options: ['Where is my book?', 'My book is blue.', 'Close the door.'], correctOptionIndex: 0 },
            { question: 'Choose the best title for a story about planting seeds.', options: ['Growing a Garden', 'Fast Cars', 'Snowy Mountains'], correctOptionIndex: 0 },
            { question: 'In "Mia packed lunch before school", what happened first?', options: ['Mia packed lunch.', 'School ended.', 'They watched a movie.'], correctOptionIndex: 0 },
            { question: 'Which word means almost the same as "happy"?', options: ['glad', 'cold', 'empty'], correctOptionIndex: 0 },
            { question: 'Which sentence uses a describing word?', options: ['The bright lamp glowed.', 'Lamp glowed.', 'Glow lamp.'], correctOptionIndex: 0 },
            { question: 'Pick the sentence with correct word order.', options: ['We walked to the park.', 'Walked park to we.', 'Park we to walked.'], correctOptionIndex: 0 },
            { question: 'Which sentence gives a command?', options: ['Please wash your hands.', 'Hands are useful.', 'I like soap.'], correctOptionIndex: 0 },
            { question: 'What is the setting in "At noon, we ate by the river"?', options: ['by the river', 'we ate', 'at noon only'], correctOptionIndex: 0 },
            { question: 'Choose the best summary: "Sam found a lost dog and returned it."', options: ['Sam helped return a lost dog.', 'Sam baked cookies.', 'Sam lost his shoes.'], correctOptionIndex: 0 }
        ],
        math: [
            { question: 'What is 7 + 5?', options: ['12', '11', '13'], correctOptionIndex: 0 },
            { question: 'What is 14 - 6?', options: ['8', '9', '7'], correctOptionIndex: 0 },
            { question: 'What is 3 × 4?', options: ['12', '10', '14'], correctOptionIndex: 0 },
            { question: 'What is 20 ÷ 5?', options: ['4', '5', '3'], correctOptionIndex: 0 },
            { question: 'What number comes next: 2, 4, 6, 8, ...?', options: ['10', '9', '11'], correctOptionIndex: 0 },
            { question: 'Which is greater?', options: ['19', '17', '16'], correctOptionIndex: 0 },
            { question: 'What is half of 18?', options: ['9', '8', '7'], correctOptionIndex: 0 },
            { question: 'A box has 6 apples and you add 3. Total?', options: ['9', '8', '10'], correctOptionIndex: 0 },
            { question: 'What is 9 + 9?', options: ['18', '17', '19'], correctOptionIndex: 0 },
            { question: 'What is 15 - 9?', options: ['6', '5', '7'], correctOptionIndex: 0 },
            { question: 'How many sides does a triangle have?', options: ['3', '4', '5'], correctOptionIndex: 0 },
            { question: 'What is 5 × 5?', options: ['25', '20', '30'], correctOptionIndex: 0 }
        ],
        spelling: [
            { question: 'Pick the correctly spelled word.', options: ['friend', 'freind', 'frend'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['school', 'scool', 'schol'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['because', 'becase', 'becuz'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['window', 'windoe', 'windo'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['pencil', 'pensil', 'pencel'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['planet', 'plannet', 'planit'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['animal', 'animel', 'anamal'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['kitchen', 'kithcen', 'kitcen'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['bridge', 'brige', 'bridg'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['library', 'libary', 'librery'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['purple', 'purpel', 'purpl'], correctOptionIndex: 0 },
            { question: 'Pick the correctly spelled word.', options: ['morning', 'mornning', 'mornig'], correctOptionIndex: 0 }
        ],
        science: [
            { question: 'What do plants need to make food?', options: ['Sunlight', 'Only candy', 'Only noise'], correctOptionIndex: 0 },
            { question: 'Water can be ice, liquid, or what?', options: ['Gas', 'Metal', 'Wood'], correctOptionIndex: 0 },
            { question: 'Which sense uses your ears?', options: ['Hearing', 'Smelling', 'Seeing'], correctOptionIndex: 0 },
            { question: 'Which planet do we live on?', options: ['Earth', 'Mars', 'Jupiter'], correctOptionIndex: 0 },
            { question: 'What force keeps us on the ground?', options: ['Gravity', 'Wind', 'Sound'], correctOptionIndex: 0 },
            { question: 'Which part of a plant holds it in the soil?', options: ['Roots', 'Leaves', 'Flowers'], correctOptionIndex: 0 },
            { question: 'Day and night are caused by Earth doing what?', options: ['Spinning', 'Stopping', 'Melting'], correctOptionIndex: 0 },
            { question: 'Which is a mammal?', options: ['Whale', 'Shark', 'Trout'], correctOptionIndex: 0 },
            { question: 'Which material is magnetic?', options: ['Iron', 'Plastic', 'Paper'], correctOptionIndex: 0 },
            { question: 'What do bees help plants do?', options: ['Pollinate', 'Freeze', 'Shrink'], correctOptionIndex: 0 },
            { question: 'Which layer protects us from too much sun?', options: ['Ozone layer', 'Cloud only', 'Ocean floor'], correctOptionIndex: 0 },
            { question: 'What gas do humans need to breathe?', options: ['Oxygen', 'Helium', 'Nitrogen only'], correctOptionIndex: 0 }
        ],
        writing: [
            { question: 'Which sentence has correct punctuation?', options: ['I like pizza.', 'I like pizza', 'I like pizza..'], correctOptionIndex: 0 },
            { question: 'Which sentence starts with a capital letter?', options: ['My dog is friendly.', 'my dog is friendly.', 'my Dog is friendly.'], correctOptionIndex: 0 },
            { question: 'Choose the complete sentence.', options: ['The sun is warm today.', 'sun warm', 'The warm'], correctOptionIndex: 0 },
            { question: 'Which word should be capitalized?', options: ['Monday', 'apple', 'street'], correctOptionIndex: 0 },
            { question: 'Pick the best ending mark for a question.', options: ['?', '.', ','], correctOptionIndex: 0 },
            { question: 'Which sentence uses a comma correctly?', options: ['After lunch, we played outside.', 'After lunch we, played outside.', 'After, lunch we played outside.'], correctOptionIndex: 0 },
            { question: 'Which is the best topic sentence?', options: ['My favorite season is summer because I can swim.', 'Summer.', 'I swim.'], correctOptionIndex: 0 },
            { question: 'Which is a proper noun?', options: ['Halifax', 'city', 'harbor'], correctOptionIndex: 0 },
            { question: 'Which sentence is written clearly?', options: ['We cleaned the room and put books on the shelf.', 'We cleaned room books shelf.', 'Cleaned and the room on shelf books.'], correctOptionIndex: 0 },
            { question: 'Choose the best closing sentence.', options: ['That is why teamwork makes chores easier.', 'Teamwork.', 'Easier chores because.'], correctOptionIndex: 0 },
            { question: 'Which sentence uses "their" correctly?', options: ['Their boots are by the door.', 'There boots are by the door.', 'They\'re boots are by the door.'], correctOptionIndex: 0 },
            { question: 'Which sentence has the best verb?', options: ['The rocket launched quickly.', 'The rocket thing quickly.', 'The rocket quickly.'], correctOptionIndex: 0 }
        ],
        mapReading: [
            { question: 'If north is up, what direction is right?', options: ['East', 'West', 'South'], correctOptionIndex: 0 },
            { question: 'If you move down on a map, which direction do you go?', options: ['South', 'North', 'East'], correctOptionIndex: 0 },
            { question: 'If west is left, what is opposite west?', options: ['East', 'North', 'South'], correctOptionIndex: 0 },
            { question: 'A map key tells you what?', options: ['What symbols mean', 'How old a map is', 'Who drew it'], correctOptionIndex: 0 },
            { question: 'Which direction is between north and east?', options: ['Northeast', 'Southwest', 'Northwest'], correctOptionIndex: 0 },
            { question: 'If a school icon is above the park icon, the school is...', options: ['North of the park', 'South of the park', 'West of the park'], correctOptionIndex: 0 },
            { question: 'A compass rose is used to show...', options: ['Directions', 'Temperatures', 'Population'], correctOptionIndex: 0 },
            { question: 'If you move from west to east, you move...', options: ['Right', 'Left', 'Down'], correctOptionIndex: 0 },
            { question: 'Which direction is opposite south?', options: ['North', 'East', 'West'], correctOptionIndex: 0 },
            { question: 'If the library is left of the store, the library is...', options: ['West of the store', 'East of the store', 'North of the store'], correctOptionIndex: 0 },
            { question: 'On most maps, up means...', options: ['North', 'South', 'East'], correctOptionIndex: 0 },
            { question: 'Which path is shortest on a grid map?', options: ['The one with fewer squares', 'The one with more turns', 'The one with bigger icons'], correctOptionIndex: 0 }
        ]
    };

    const entries = [];
    Object.entries(raw).forEach(([category, questions]) => {
        questions.forEach((question, index) => {
            const idSuffix = String(index + 1).padStart(3, '0');
            const quest = createQuestEntry(category, idSuffix, {
                title: `${EDUCATIONAL_CATEGORY_DEFINITIONS[category].label} MISSION ${index + 1}`,
                ...question
            });
            if (quest) {
                entries.push(quest);
            }
        });
    });
    return entries;
}

const EDUCATIONAL_QUEST_LIBRARY = buildEducationalQuestLibrary();

function refillEducationalCategory(board, categoryKey, completedQuestIds) {
    if (!board || !Array.isArray(board.quests)) {
        return;
    }

    const completedIds = completedQuestIds instanceof Set ? completedQuestIds : new Set();
    const existingCategory = board.quests.filter(quest => quest.category === categoryKey);
    const existingIds = new Set(board.quests.map((quest) => quest.id));

    const candidates = EDUCATIONAL_QUEST_LIBRARY.filter((quest) => (
        quest.category === categoryKey
        && !completedIds.has(quest.id)
        && !existingIds.has(quest.id)
    ));

    const shuffledCandidates = shuffleArray(candidates);
    while (existingCategory.length < EDUCATIONAL_QUESTS_PER_CATEGORY && shuffledCandidates.length > 0) {
        const nextQuest = shuffledCandidates.shift();
        board.quests.push(nextQuest);
        existingCategory.push(nextQuest);
    }
}

function createEducationalBoard(completedQuestIds) {
    const board = {
        generatedAt: new Date().toISOString(),
        quests: []
    };

    EDUCATIONAL_CATEGORY_ORDER.forEach((categoryKey) => {
        refillEducationalCategory(board, categoryKey, completedQuestIds);
    });

    return board;
}

function getSafeEducationalCategories() {
    return EDUCATIONAL_CATEGORY_ORDER.map((id) => ({
        id,
        label: EDUCATIONAL_CATEGORY_DEFINITIONS[id]?.label || id.toUpperCase()
    }));
}

function ensureEducationalBoard(playerData, { force = false } = {}) {
    const completedQuestIds = new Set(
        (playerData?.educationalCompleted || [])
            .map((entry) => entry?.questId)
            .filter(Boolean)
    );

    const board = playerData?.educationalBoard;
    if (force || !board || !Array.isArray(board.quests)) {
        playerData.educationalBoard = createEducationalBoard(completedQuestIds);
        return playerData.educationalBoard;
    }

    board.quests = board.quests.filter((quest) => !completedQuestIds.has(quest.id));
    EDUCATIONAL_CATEGORY_ORDER.forEach((categoryKey) => {
        refillEducationalCategory(board, categoryKey, completedQuestIds);
    });
    board.generatedAt = board.generatedAt || new Date().toISOString();

    return board;
}

function registerPlayerRoutes(app, deps) {
    const {
        getGameState,
        ensurePlayerProgressFields,
        getXpRequiredForLevel,
        scheduleAutoSave
    } = deps;

    app.get('/api/player/:player', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();
        if (gameState.players[player]) {
            ensurePlayerProgressFields(gameState.players[player]);
            res.json(gameState.players[player]);
        } else {
            res.status(404).json({ error: 'Player not found' });
        }
    });

    app.get('/api/quests', (req, res) => {
        const gameState = getGameState();
        res.json(gameState.quests);
    });

    app.get('/api/random-quest', (req, res) => {
        const gameState = getGameState();
        if (gameState.randomQuests && gameState.randomQuests.length > 0) {
            const randomQuest = gameState.randomQuests[Math.floor(Math.random() * gameState.randomQuests.length)];
            res.json(randomQuest);
        } else {
            res.status(404).json({ error: 'No random quests available' });
        }
    });

    app.get('/api/player/:player/educational-quests', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();
        const playerData = gameState.players[player];

        if (!playerData) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const board = ensureEducationalBoard(playerData);
        const safeQuests = (board.quests || []).map((quest) => ({
            id: quest.id,
            category: quest.category,
            categoryLabel: quest.categoryLabel,
            title: quest.title,
            question: quest.question,
            options: Array.isArray(quest.options) ? quest.options : [],
            rewardTabs: Number(quest.rewardTabs || 0),
            rewardXp: Number(quest.rewardXp || 0)
        }));

        res.json({
            categories: getSafeEducationalCategories(),
            generatedAt: board.generatedAt,
            quests: safeQuests
        });
    });

    app.post('/api/player/:player/complete-random-quest', (req, res) => {
        const { player } = req.params;
        const { questId } = req.body;
        const gameState = getGameState();
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

    app.post('/api/player/:player/complete-educational-quest', (req, res) => {
        const { player } = req.params;
        const { questId, answerIndex } = req.body;
        const gameState = getGameState();
        const playerData = gameState.players[player];

        if (!playerData) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const alreadyCompleted = Array.isArray(playerData.educationalCompleted)
            && playerData.educationalCompleted.some((entry) => entry?.questId === questId);
        if (alreadyCompleted) {
            return res.status(409).json({ error: 'Educational quest already completed and cannot be repeated.' });
        }

        const board = ensureEducationalBoard(playerData);
        const educationalQuests = Array.isArray(board.quests) ? board.quests : [];
        const questIndex = educationalQuests.findIndex(q => q.id === questId);
        const quest = questIndex >= 0 ? educationalQuests[questIndex] : null;
        if (!quest) {
            return res.status(404).json({ error: 'Educational quest not found' });
        }

        if (!Number.isInteger(answerIndex)) {
            return res.status(400).json({ error: 'answerIndex must be an integer.' });
        }

        const optionCount = Array.isArray(quest.options) ? quest.options.length : 0;
        if (optionCount <= 0 || answerIndex < 0 || answerIndex >= optionCount) {
            return res.status(400).json({ error: 'Invalid answerIndex for this educational quest.' });
        }

        ensurePlayerProgressFields(playerData);

        const isCorrect = Number(quest.correctOptionIndex) === answerIndex;
        const tabsReward = isCorrect ? Number(quest.rewardTabs || 0) : 0;
        const xpReward = isCorrect ? Number(quest.rewardXp || 0) : 0;
        playerData.tabs = (playerData.tabs || 0) + tabsReward;
        playerData.xp = (playerData.xp || 0) + xpReward;

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

        let hpPenalty = 0;
        let radsPenalty = 0;
        if (!isCorrect) {
            hpPenalty = Number(quest.wrongPenalty?.hp || 0);
            radsPenalty = Number(quest.wrongPenalty?.rads || 0);
            if (hpPenalty > 0) {
                playerData.hp = Math.max(0, (playerData.hp || 0) - hpPenalty);
            }
            if (radsPenalty > 0) {
                playerData.rads = Math.min(10, (playerData.rads || 0) + radsPenalty);
            }
        }

        if (!Array.isArray(playerData.educationalCompleted)) {
            playerData.educationalCompleted = [];
        }
        playerData.educationalCompleted.push({
            questId: quest.id,
            category: quest.category,
            title: quest.title,
            correct: isCorrect,
            answerIndex,
            tabs: tabsReward,
            xp: xpReward,
            hpPenalty,
            radsPenalty,
            completedAt: new Date().toISOString()
        });

        if (!Array.isArray(playerData.dailyCompleted)) {
            playerData.dailyCompleted = [];
        }
        playerData.dailyCompleted.push({
            title: `[EDU] ${quest.title} ${isCorrect ? '(CORRECT)' : '(WRONG)'}`,
            reward: tabsReward,
            xp: xpReward,
            time: new Date().toLocaleTimeString()
        });

        educationalQuests.splice(questIndex, 1);
        const completedQuestIds = new Set((playerData.educationalCompleted || []).map((entry) => entry?.questId).filter(Boolean));
        refillEducationalCategory(board, quest.category, completedQuestIds);
        board.generatedAt = new Date().toISOString();

        scheduleAutoSave();

        res.json({
            success: true,
            message: isCorrect
                ? `${player} answered ${quest.title} correctly`
                : `${player} answered ${quest.title} incorrectly`,
            correct: isCorrect,
            reward: {
                tabs: tabsReward,
                xp: xpReward,
                levelsGained
            },
            penalty: {
                hp: hpPenalty,
                rads: radsPenalty
            }
        });
    });

    app.get('/api/radio', (req, res) => {
        const gameState = getGameState();
        const allSignals = [...(gameState.radioSignals || []), ...(gameState.broadcastSignals || [])];
        res.json(allSignals);
    });

    app.get('/api/perks', (req, res) => {
        const gameState = getGameState();
        res.json(gameState.perks);
    });

    app.get('/api/recipes', (req, res) => {
        const gameState = getGameState();
        res.json(gameState.recipes);
    });

    app.get('/api/player/:player/perks', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();
        if (gameState.players[player]) {
            const playerPerks = gameState.players[player].unlockedPerks.map(perkId =>
                gameState.perks.find(p => p.id === perkId)
            ).filter(p => p);
            res.json(playerPerks);
        } else {
            res.status(404).json({ error: 'Player not found' });
        }
    });
}

module.exports = registerPlayerRoutes;
