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

function isEducationalCategory(categoryId) {
    return EDUCATIONAL_CATEGORY_ORDER.includes(categoryId);
}

function shuffleArray(items) {
    const next = [...items];
    for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
}

function randomInt(min, max) {
    const floorMin = Math.ceil(min);
    const floorMax = Math.floor(max);
    return Math.floor(Math.random() * (floorMax - floorMin + 1)) + floorMin;
}

function pickRandom(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return null;
    }
    return items[randomInt(0, items.length - 1)];
}

const RANDOM_TASK_OBJECTS = ['room', 'desk', 'shelf', 'table', 'entryway', 'backpack'];
const RANDOM_TASK_AREAS = ['living room', 'kitchen', 'bedroom', 'hallway', 'play area'];
const RANDOM_TASK_MOVES = ['jumping jacks', 'step-ups', 'squats', 'balance holds', 'fast marches'];
const RANDOM_TASK_CREATIVE = ['comic panel', 'mini poster', 'short story', 'checklist chart', 'team signal card'];

let generatedRandomQuestCounter = 0;

function createProceduralRandomQuest() {
    const missionType = pickRandom(['tidy', 'movement', 'learning', 'creative']);
    generatedRandomQuestCounter += 1;
    const id = `rq-gen-${Date.now()}-${generatedRandomQuestCounter}`;

    if (missionType === 'tidy') {
        const targetArea = pickRandom(RANDOM_TASK_AREAS);
        const targetObject = pickRandom(RANDOM_TASK_OBJECTS);
        const itemCount = randomInt(8, 18);
        const minutes = randomInt(6, 12);
        return {
            id,
            title: `HOUSE: ${targetArea.toUpperCase()} RESET`,
            desc: `Set a ${minutes}-minute timer. Put away ${itemCount} items, organize one ${targetObject}, and report when the zone is clear.`,
            reward: randomInt(2, 4),
            xp: randomInt(0, 1),
            generated: true
        };
    }

    if (missionType === 'movement') {
        const movement = pickRandom(RANDOM_TASK_MOVES);
        const rounds = randomInt(2, 4);
        const count = randomInt(8, 15);
        return {
            id,
            title: 'SPORT: FIELD DRILL',
            desc: `Complete ${rounds} rounds of ${count} ${movement} safely with good form. Take a short break between rounds.`,
            reward: randomInt(3, 5),
            xp: 1,
            generated: true
        };
    }

    if (missionType === 'learning') {
        const minutes = randomInt(8, 15);
        const facts = randomInt(2, 4);
        return {
            id,
            title: 'LEARNING: FACT SCAN',
            desc: `Read or listen for ${minutes} minutes, then share ${facts} facts you learned with the GM.`,
            reward: randomInt(3, 5),
            xp: 1,
            generated: true
        };
    }

    const creativeProject = pickRandom(RANDOM_TASK_CREATIVE);
    const steps = randomInt(3, 5);
    return {
        id,
        title: 'CRAFT: CREATIVE BUILD',
        desc: `Create one ${creativeProject} in ${steps} clear steps, then explain it in one sentence.`,
        reward: randomInt(3, 5),
        xp: randomInt(0, 1),
        generated: true
    };
}

function issueRandomQuestForPlayer(playerData, gameState) {
    const staticQuestPool = Array.isArray(gameState?.randomQuests) ? gameState.randomQuests : [];
    const useProcedural = staticQuestPool.length === 0 || Math.random() < 0.75;
    const quest = useProcedural
        ? createProceduralRandomQuest()
        : staticQuestPool[Math.floor(Math.random() * staticQuestPool.length)];

    if (!quest) {
        return null;
    }

    playerData.activeRandomQuest = {
        ...quest,
        issuedAt: new Date().toISOString()
    };
    return playerData.activeRandomQuest;
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

let generatedEducationalQuestCounter = 0;

function createProceduralQuestPayload(category) {
    if (category === 'math') {
        const mode = pickRandom(['add', 'subtract', 'multiply', 'divide']);
        if (mode === 'add') {
            const a = randomInt(3, 40);
            const b = randomInt(2, 30);
            const answer = a + b;
            return {
                title: 'MATH MISSION (GENERATED)',
                question: `What is ${a} + ${b}?`,
                options: [String(answer), String(answer + pickRandom([1, 2, 3])), String(Math.max(0, answer - pickRandom([1, 2, 3])))],
                correctOptionIndex: 0
            };
        }
        if (mode === 'subtract') {
            const a = randomInt(10, 60);
            const b = randomInt(1, Math.min(30, a - 1));
            const answer = a - b;
            return {
                title: 'MATH MISSION (GENERATED)',
                question: `What is ${a} - ${b}?`,
                options: [String(answer), String(answer + pickRandom([1, 2, 4])), String(Math.max(0, answer - pickRandom([1, 2, 4])))],
                correctOptionIndex: 0
            };
        }
        if (mode === 'multiply') {
            const a = randomInt(2, 12);
            const b = randomInt(2, 12);
            const answer = a * b;
            return {
                title: 'MATH MISSION (GENERATED)',
                question: `What is ${a} × ${b}?`,
                options: [String(answer), String(answer + pickRandom([a, b, 2])), String(Math.max(0, answer - pickRandom([a, b, 2])))],
                correctOptionIndex: 0
            };
        }

        const divisor = randomInt(2, 12);
        const answer = randomInt(2, 12);
        const dividend = divisor * answer;
        return {
            title: 'MATH MISSION (GENERATED)',
            question: `What is ${dividend} ÷ ${divisor}?`,
            options: [String(answer), String(answer + pickRandom([1, 2, 3])), String(Math.max(1, answer - pickRandom([1, 2, 3])))],
            correctOptionIndex: 0
        };
    }

    if (category === 'spelling') {
        const words = ['friend', 'school', 'because', 'window', 'pencil', 'planet', 'animal', 'kitchen', 'bridge', 'library', 'purple', 'morning', 'harbor', 'signal', 'mission'];
        const correct = pickRandom(words);
        if (!correct || correct.length < 4) {
            return null;
        }
        const swapIndex = randomInt(1, correct.length - 2);
        const swapped = `${correct.slice(0, swapIndex)}${correct.charAt(swapIndex + 1)}${correct.charAt(swapIndex)}${correct.slice(swapIndex + 2)}`;
        const missingLetterIndex = randomInt(1, correct.length - 2);
        const missingLetter = `${correct.slice(0, missingLetterIndex)}${correct.slice(missingLetterIndex + 1)}`;
        return {
            title: 'SPELLING MISSION (GENERATED)',
            question: 'Pick the correctly spelled word.',
            options: [correct, swapped, missingLetter],
            correctOptionIndex: 0
        };
    }

    if (category === 'reading') {
        const names = ['Mia', 'Logan', 'Rylyn', 'Ava', 'Noah', 'Ella'];
        const verbs = ['packed', 'cleaned', 'sorted', 'carried', 'organized', 'checked'];
        const objects = ['backpack', 'books', 'supplies', 'boots', 'radio', 'map'];
        const places = ['before school', 'in the hallway', 'at the table', 'near the door', 'in the shelter'];
        const name = pickRandom(names);
        const verb = pickRandom(verbs);
        const object = pickRandom(objects);
        const place = pickRandom(places);
        return {
            title: 'READING MISSION (GENERATED)',
            question: `In this sentence: "${name} ${verb} the ${object} ${place}." What is the action word?`,
            options: [verb, object, name],
            correctOptionIndex: 0
        };
    }

    if (category === 'science') {
        const facts = [
            { q: 'What gas do humans need to breathe?', a: 'Oxygen', b: 'Helium', c: 'Carbon dioxide' },
            { q: 'Which part of a plant absorbs water from soil?', a: 'Roots', b: 'Leaves', c: 'Flowers' },
            { q: 'Which planet do we live on?', a: 'Earth', b: 'Mars', c: 'Venus' },
            { q: 'What force pulls objects toward Earth?', a: 'Gravity', b: 'Magnetism', c: 'Friction' },
            { q: 'What do bees help plants do?', a: 'Pollinate', b: 'Hibernate', c: 'Evaporate' }
        ];
        const fact = pickRandom(facts);
        return {
            title: 'SCIENCE MISSION (GENERATED)',
            question: fact.q,
            options: [fact.a, fact.b, fact.c],
            correctOptionIndex: 0
        };
    }

    if (category === 'writing') {
        const samples = [
            {
                q: 'Which sentence is punctuated correctly?',
                options: ['We finished our quest.', 'We finished our quest', 'We finished our quest..']
            },
            {
                q: 'Which sentence starts with a capital letter?',
                options: ['Today we trained at the harbor.', 'today we trained at the harbor.', 'today We trained at the harbor.']
            },
            {
                q: 'Which sentence uses the comma correctly?',
                options: ['After dinner, we cleaned the table.', 'After dinner we, cleaned the table.', 'After, dinner we cleaned the table.']
            }
        ];
        const sample = pickRandom(samples);
        return {
            title: 'WRITING MISSION (GENERATED)',
            question: sample.q,
            options: sample.options,
            correctOptionIndex: 0
        };
    }

    if (category === 'mapReading') {
        const directions = ['North', 'East', 'South', 'West'];
        const opposite = { North: 'South', South: 'North', East: 'West', West: 'East' };
        const dir = pickRandom(directions);
        const wrongOne = pickRandom(directions.filter((item) => item !== opposite[dir]));
        const wrongTwo = pickRandom(directions.filter((item) => item !== opposite[dir] && item !== wrongOne));
        return {
            title: 'MAP READING MISSION (GENERATED)',
            question: `Which direction is opposite ${dir}?`,
            options: [opposite[dir], wrongOne, wrongTwo],
            correctOptionIndex: 0
        };
    }

    return null;
}

function createProceduralEducationalQuest(category, board) {
    const existingIds = new Set((board?.quests || []).map((quest) => quest.id));
    const existingQuestions = new Set((board?.quests || []).map((quest) => quest.question));

    for (let attempt = 0; attempt < 8; attempt += 1) {
        const payload = createProceduralQuestPayload(category);
        if (!payload) {
            return null;
        }

        generatedEducationalQuestCounter += 1;
        const idSuffix = `gen-${Date.now()}-${generatedEducationalQuestCounter}`;
        const quest = createQuestEntry(category, idSuffix, payload);
        if (!quest) {
            return null;
        }

        if (!existingIds.has(quest.id) && !existingQuestions.has(quest.question)) {
            return quest;
        }
    }

    return null;
}

function refillEducationalCategory(board, categoryKey) {
    if (!board || !Array.isArray(board.quests)) {
        return;
    }

    const existingCategory = board.quests.filter(quest => quest.category === categoryKey);
    const existingIds = new Set(board.quests.map((quest) => quest.id));

    const candidates = EDUCATIONAL_QUEST_LIBRARY.filter((quest) => (
        quest.category === categoryKey
        && !existingIds.has(quest.id)
    ));

    const shuffledCandidates = shuffleArray(candidates);
    while (existingCategory.length < EDUCATIONAL_QUESTS_PER_CATEGORY) {
        let nextQuest = createProceduralEducationalQuest(categoryKey, board);
        if (!nextQuest && shuffledCandidates.length > 0) {
            nextQuest = shuffledCandidates.shift();
        }
        if (!nextQuest) {
            break;
        }
        board.quests.push(nextQuest);
        existingCategory.push(nextQuest);
    }
}

function createGeneratedEducationalQuest(board, categoryKey) {
    if (!board || !isEducationalCategory(categoryKey)) {
        return null;
    }

    let quest = createProceduralEducationalQuest(categoryKey, board);
    if (!quest) {
        const existingIds = new Set((board.quests || []).map((item) => item.id));
        const candidates = EDUCATIONAL_QUEST_LIBRARY.filter((item) => (
            item.category === categoryKey
            && !existingIds.has(item.id)
        ));
        const fallback = pickRandom(candidates);
        quest = fallback || null;
    }

    if (!quest) {
        return null;
    }

    board.quests = Array.isArray(board.quests) ? board.quests : [];
    board.quests.push(quest);
    board.generatedAt = new Date().toISOString();
    return quest;
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
    if (force || !board || !Array.isArray(board.quests)) {
        playerData.educationalBoard = createEducationalBoard();
        return playerData.educationalBoard;
    }

    EDUCATIONAL_CATEGORY_ORDER.forEach((categoryKey) => {
        refillEducationalCategory(board, categoryKey);
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

    function addXpWithLeveling(playerData, xpAmount) {
        let levelsGained = 0;
        const safeXp = Number(xpAmount || 0);
        if (safeXp <= 0) {
            return levelsGained;
        }

        playerData.xp = (playerData.xp || 0) + safeXp;
        let xpNeeded = getXpRequiredForLevel(playerData.level);
        while (playerData.xp >= xpNeeded) {
            playerData.xp -= xpNeeded;
            playerData.level += 1;
            levelsGained += 1;
            xpNeeded = getXpRequiredForLevel(playerData.level);
        }

        playerData.pendingPerks = (playerData.pendingPerks || 0) + levelsGained;
        ensurePlayerProgressFields(playerData);
        return levelsGained;
    }

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

    app.get('/api/player/:player/random-quest', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();
        const playerData = gameState.players[player];

        if (!playerData) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const quest = issueRandomQuestForPlayer(playerData, gameState);
        if (!quest) {
            return res.status(404).json({ error: 'No random tasks available' });
        }

        scheduleAutoSave();
        res.json(quest);
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

    app.post('/api/player/:player/educational-quests/generate', (req, res) => {
        const { player } = req.params;
        const { category } = req.body;
        const gameState = getGameState();
        const playerData = gameState.players[player];

        if (!playerData) {
            return res.status(404).json({ error: 'Player not found' });
        }

        if (!isEducationalCategory(category)) {
            return res.status(400).json({ error: 'Invalid educational category.' });
        }

        const board = ensureEducationalBoard(playerData);
        const quest = createGeneratedEducationalQuest(board, category);
        if (!quest) {
            return res.status(404).json({ error: 'Could not generate educational quiz for this category.' });
        }

        scheduleAutoSave();

        return res.json({
            id: quest.id,
            category: quest.category,
            categoryLabel: quest.categoryLabel,
            title: quest.title,
            question: quest.question,
            options: Array.isArray(quest.options) ? quest.options : [],
            rewardTabs: Number(quest.rewardTabs || 0),
            rewardXp: Number(quest.rewardXp || 0)
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

        const activeQuest = playerData.activeRandomQuest;
        const quest = (activeQuest && activeQuest.id === questId) ? activeQuest : null;
        if (!quest) {
            return res.status(404).json({ error: 'Random task not found or not currently active for this player.' });
        }

        ensurePlayerProgressFields(playerData);

        const tabsReward = quest.reward || 0;
        const xpReward = quest.xp || 0;
        playerData.tabs += tabsReward;
        const levelsGained = addXpWithLeveling(playerData, xpReward);
        if (playerData.activeRandomQuest && playerData.activeRandomQuest.id === questId) {
            playerData.activeRandomQuest = null;
        }

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
        const levelsGained = addXpWithLeveling(playerData, xpReward);

        let hpPenalty = 0;
        let radsPenalty = 0;
        if (!isCorrect) {
            hpPenalty = Number(quest.wrongPenalty?.hp || 0);
            radsPenalty = Number(quest.wrongPenalty?.rads || 0);
            if (hpPenalty > 0) {
                playerData.hp = Math.max(0, (playerData.hp || 0) - hpPenalty);
            }
            if (radsPenalty > 0) {
                playerData.rads = Math.min(playerData.maxRads || 10, (playerData.rads || 0) + radsPenalty);
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
