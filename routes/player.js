const EDUCATIONAL_QUESTS_PER_CATEGORY = 3;
const EDUCATIONAL_BOARD_TTL_MS = 30 * 60 * 1000;

const EDUCATIONAL_CATEGORY_DEFINITIONS = {
    reading: {
        label: 'READING',
        rewardTabs: 1,
        rewardXp: 0,
        wrongPenalty: { hp: 1 },
        templates: [
            () => {
                const prompts = [
                    { sentence: 'The red kite flew over the hill.', answer: 'red', distractors: ['kite', 'hill'] },
                    { sentence: 'A tiny frog hid near the pond.', answer: 'frog', distractors: ['tiny', 'pond'] },
                    { sentence: 'The bright moon lit the path.', answer: 'moon', distractors: ['bright', 'path'] }
                ];
                const pick = prompts[Math.floor(Math.random() * prompts.length)];
                return {
                    question: `Which word names an object in this sentence: "${pick.sentence}"?`,
                    options: [pick.answer, ...pick.distractors],
                    correctOptionIndex: 0
                };
            },
            () => {
                const pairs = [
                    { sentence: 'The puppy can bark.', answer: 'bark' },
                    { sentence: 'Birds can glide.', answer: 'glide' },
                    { sentence: 'Kids can jump.', answer: 'jump' }
                ];
                const pick = pairs[Math.floor(Math.random() * pairs.length)];
                return {
                    question: `What is the action word in: "${pick.sentence}"?`,
                    options: [pick.answer, 'the', 'can'],
                    correctOptionIndex: 0
                };
            }
        ]
    },
    math: {
        label: 'MATH',
        rewardTabs: 1,
        rewardXp: 1,
        wrongPenalty: { rads: 1 },
        templates: [
            () => {
                const a = Math.floor(Math.random() * 6) + 2;
                const b = Math.floor(Math.random() * 6) + 2;
                const answer = a + b;
                return {
                    question: `What is ${a} + ${b}?`,
                    options: [answer, answer - 1, answer + 2].map(String),
                    correctOptionIndex: 0
                };
            },
            () => {
                const a = Math.floor(Math.random() * 8) + 6;
                const b = Math.floor(Math.random() * 5) + 1;
                const answer = a - b;
                return {
                    question: `What is ${a} - ${b}?`,
                    options: [answer, answer + 1, Math.max(0, answer - 2)].map(String),
                    correctOptionIndex: 0
                };
            }
        ]
    },
    spelling: {
        label: 'SPELLING',
        rewardTabs: 1,
        rewardXp: 0,
        wrongPenalty: { hp: 1 },
        templates: [
            () => {
                const items = [
                    { correct: 'friend', wrong: ['frend', 'freind'] },
                    { correct: 'school', wrong: ['scool', 'scholl'] },
                    { correct: 'because', wrong: ['becuz', 'becase'] }
                ];
                const pick = items[Math.floor(Math.random() * items.length)];
                return {
                    question: 'Which spelling is correct?',
                    options: [pick.correct, ...pick.wrong],
                    correctOptionIndex: 0
                };
            },
            () => {
                const items = [
                    { correct: 'planet', wrong: ['planit', 'plannet'] },
                    { correct: 'window', wrong: ['windoe', 'windo'] },
                    { correct: 'pencil', wrong: ['pensil', 'pencel'] }
                ];
                const pick = items[Math.floor(Math.random() * items.length)];
                return {
                    question: 'Pick the correctly spelled word.',
                    options: [pick.correct, ...pick.wrong],
                    correctOptionIndex: 0
                };
            }
        ]
    },
    science: {
        label: 'SCIENCE',
        rewardTabs: 2,
        rewardXp: 1,
        wrongPenalty: { rads: 1 },
        templates: [
            () => ({
                question: 'What do plants need most to grow?',
                options: ['Sunlight and water', 'Only candy', 'Only darkness'],
                correctOptionIndex: 0
            }),
            () => ({
                question: 'Which state of matter takes the shape of its container?',
                options: ['Liquid', 'Rock', 'Metal spoon'],
                correctOptionIndex: 0
            }),
            () => ({
                question: 'What force pulls objects down toward Earth?',
                options: ['Gravity', 'Music', 'Magnet paint'],
                correctOptionIndex: 0
            })
        ]
    },
    writing: {
        label: 'WRITING',
        rewardTabs: 1,
        rewardXp: 0,
        wrongPenalty: { hp: 1 },
        templates: [
            () => ({
                question: 'Which sentence has correct ending punctuation?',
                options: ['I like dogs.', 'I like dogs', 'I like dogs..'],
                correctOptionIndex: 0
            }),
            () => ({
                question: 'Which sentence starts with a capital letter?',
                options: ['My cat runs fast.', 'my cat runs fast.', 'my Cat runs fast.'],
                correctOptionIndex: 0
            }),
            () => ({
                question: 'Choose the best complete sentence.',
                options: ['The sun is bright today.', 'sun bright today', 'The sun bright'],
                correctOptionIndex: 0
            })
        ]
    },
    mapReading: {
        label: 'MAP READING',
        rewardTabs: 1,
        rewardXp: 1,
        wrongPenalty: { rads: 1 },
        templates: [
            () => ({
                question: 'If north is up, what direction is to the right?',
                options: ['East', 'West', 'South'],
                correctOptionIndex: 0
            }),
            () => ({
                question: 'If you move down on a map, which direction are you moving?',
                options: ['South', 'North', 'East'],
                correctOptionIndex: 0
            }),
            () => ({
                question: 'On a simple map, a compass rose helps you find what?',
                options: ['Directions', 'Snacks', 'Weather only'],
                correctOptionIndex: 0
            })
        ]
    }
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

function createGeneratedEducationalQuest(categoryKey) {
    const categoryDef = EDUCATIONAL_CATEGORY_DEFINITIONS[categoryKey];
    if (!categoryDef) {
        return null;
    }

    const templates = Array.isArray(categoryDef.templates) ? categoryDef.templates : [];
    if (templates.length === 0) {
        return null;
    }

    const template = templates[Math.floor(Math.random() * templates.length)];
    const generated = template();
    if (!generated || !Array.isArray(generated.options)) {
        return null;
    }

    const correctIndex = Number(generated.correctOptionIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= generated.options.length) {
        return null;
    }

    const pairedOptions = generated.options.map((text, index) => ({ text: String(text), isCorrect: index === correctIndex }));
    const shuffled = shuffleArray(pairedOptions);
    const shuffledCorrectIndex = shuffled.findIndex(option => option.isCorrect);
    const difficultyBoost = Math.random() < 0.25 ? 1 : 0;

    return {
        id: `edu-${categoryKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: categoryKey,
        categoryLabel: categoryDef.label,
        title: `${categoryDef.label} DRILL`,
        question: generated.question,
        options: shuffled.map(option => option.text),
        correctOptionIndex: shuffledCorrectIndex,
        rewardTabs: Number(categoryDef.rewardTabs || 0) + difficultyBoost,
        rewardXp: Number(categoryDef.rewardXp || 0),
        wrongPenalty: {
            hp: Number(categoryDef.wrongPenalty?.hp || 0),
            rads: Number(categoryDef.wrongPenalty?.rads || 0)
        }
    };
}

function refillEducationalCategory(board, categoryKey) {
    if (!board || !Array.isArray(board.quests)) {
        return;
    }

    const forCategory = board.quests.filter(quest => quest.category === categoryKey);
    let attempts = 0;

    while (forCategory.length < EDUCATIONAL_QUESTS_PER_CATEGORY && attempts < 20) {
        const generated = createGeneratedEducationalQuest(categoryKey);
        attempts += 1;
        if (!generated) {
            continue;
        }

        const duplicateQuestion = forCategory.some(existing => existing.question === generated.question);
        if (duplicateQuestion) {
            continue;
        }

        board.quests.push(generated);
        forCategory.push(generated);
    }
}

function createEducationalBoard() {
    const board = {
        generatedAt: new Date().toISOString(),
        quests: []
    };

    EDUCATIONAL_CATEGORY_ORDER.forEach((categoryKey) => {
        refillEducationalCategory(board, categoryKey);
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
    const board = playerData?.educationalBoard;
    const generatedAtMs = board?.generatedAt ? Date.parse(board.generatedAt) : NaN;
    const boardIsExpired = Number.isFinite(generatedAtMs)
        ? (Date.now() - generatedAtMs) > EDUCATIONAL_BOARD_TTL_MS
        : true;

    if (force || !board || !Array.isArray(board.quests) || boardIsExpired) {
        playerData.educationalBoard = createEducationalBoard();
        return playerData.educationalBoard;
    }

    EDUCATIONAL_CATEGORY_ORDER.forEach((categoryKey) => {
        refillEducationalCategory(board, categoryKey);
    });

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
        refillEducationalCategory(board, quest.category);
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
