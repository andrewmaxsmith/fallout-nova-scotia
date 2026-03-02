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
