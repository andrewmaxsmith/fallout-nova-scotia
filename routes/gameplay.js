function registerGameplayRoutes(app, deps) {
    const {
        getGameState,
        setGameState,
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
        getGameStateVersion
    } = deps;

    app.get('/api/game-state', (req, res) => {
        const gameState = getGameState();
        const migratedState = migrateGameState(gameState);
        if (migratedState && migratedState !== gameState) {
            setGameState(migratedState);
        }

        const currentState = getGameState();
        Object.values(currentState.players).forEach(ensurePlayerProgressFields);
        res.json(currentState);
    });

    app.get('/api/save/export', (req, res) => {
        const gameState = getGameState();
        Object.values(gameState.players).forEach(ensurePlayerProgressFields);
        res.json({
            exportedAt: new Date().toISOString(),
            version: getGameStateVersion(),
            state: gameState
        });
    });

    app.post('/api/save/import', async (req, res) => {
        const incomingState = req.body?.state || req.body;

        if (!incomingState || typeof incomingState !== 'object') {
            return res.status(400).json({ error: 'Invalid payload. Provide a game state object or { state: ... }.' });
        }

        const migratedState = migrateGameState(incomingState);
        if (!migratedState || !migratedState.players || typeof migratedState.players !== 'object') {
            return res.status(400).json({ error: 'Invalid game state structure.' });
        }

        const playerKeys = Object.keys(migratedState.players);
        if (playerKeys.length === 0) {
            return res.status(400).json({ error: 'Imported game state must include at least one player.' });
        }

        const previousState = getGameState();

        try {
            setGameState(migratedState);
            const gameState = getGameState();
            Object.values(gameState.players).forEach(ensurePlayerProgressFields);
            await persistGameState('import', true);

            return res.json({
                success: true,
                message: 'Game state imported successfully.',
                players: playerKeys
            });
        } catch (error) {
            setGameState(previousState);
            return res.status(500).json({ error: `Import failed: ${error.message}` });
        }
    });

    app.post('/api/player/:player/stat/:stat', (req, res) => {
        const { player, stat } = req.params;
        const { value } = req.body;
        const gameState = getGameState();

        const validation = validateNumber(value, { min: -999999, max: 999999, integer: true, label: 'value' });
        if (!validation.ok) {
            return res.status(400).json({ error: validation.error });
        }

        if (gameState.players[player] && gameState.players[player][stat] !== undefined) {
            gameState.players[player][stat] = validation.value;
            scheduleAutoSave();
            res.json({ success: true, message: `Updated ${player} ${stat}` });
        } else {
            res.status(404).json({ error: 'Player or stat not found' });
        }
    });

    app.post('/api/player/:player/stats', (req, res) => {
        const { player } = req.params;
        const { stats } = req.body;
        const gameState = getGameState();

        const statKeys = ['charm', 'hardiness', 'agility', 'perception', 'politeness', 'yarns'];
        const statsValidation = validateNumericRecord(stats, {
            allowedKeys: statKeys,
            min: 0,
            max: 20,
            integer: true,
            label: 'stats'
        });

        if (!statsValidation.ok) {
            return res.status(400).json({ error: statsValidation.error });
        }

        if (gameState.players[player]) {
            gameState.players[player].stats = stats;
            scheduleAutoSave();
            res.json({ success: true, message: `Updated ${player} stats`, stats: stats });
        } else {
            res.status(404).json({ error: 'Player not found' });
        }
    });

    app.post('/api/player/:player/quest', (req, res) => {
        const { player } = req.params;
        const { questId } = req.body;
        const gameState = getGameState();

        if (gameState.players[player] && questId) {
            const quest = gameState.quests.find(q => q.id === questId);
            if (quest && !gameState.players[player].activeQuests.includes(questId)) {
                gameState.players[player].activeQuests.push(questId);

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

    app.post('/api/player/:player/radio', (req, res) => {
        const { player } = req.params;
        const { radioId } = req.body;
        const gameState = getGameState();

        if (gameState.players[player]) {
            gameState.players[player].activeRadio = radioId;
            gameState.players[player].activeRadioData = null;
            scheduleAutoSave();
            res.json({ success: true, message: `Radio signal sent to ${player}` });
        }
    });

    app.post('/api/player/:player/radio-message', (req, res) => {
        const { player } = req.params;
        const { message } = req.body;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }
        if (typeof message !== 'string') {
            return res.status(400).json({ error: 'Message must be text' });
        }

        const cleanedMessage = message.trim();
        if (cleanedMessage.length === 0 || cleanedMessage.length > 280) {
            return res.status(400).json({ error: 'Message must be 1-280 characters' });
        }

        const customSignal = {
            id: `custom_${Date.now()}`,
            title: 'OVERSEER TRANSMISSION',
            frequency: '88.5 FM',
            text: cleanedMessage,
            type: 'custom'
        };

        gameState.players[player].activeRadio = customSignal.id;
        gameState.players[player].activeRadioData = customSignal;
        scheduleAutoSave();
        res.json({ success: true, message: 'Custom signal sent', signal: customSignal });
    });

    app.post('/api/player/:player/radio-overseer', (req, res) => {
        const { player } = req.params;
        const { message } = req.body;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }
        if (typeof message !== 'string') {
            return res.status(400).json({ error: 'Message must be text' });
        }

        const cleanedMessage = message.trim();
        if (cleanedMessage.length === 0 || cleanedMessage.length > 280) {
            return res.status(400).json({ error: 'Message must be 1-280 characters' });
        }

        if (!Array.isArray(gameState.overseerInbox)) {
            gameState.overseerInbox = [];
        }

        const transmission = {
            id: `ovr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            player,
            title: `${player.toUpperCase()} TRANSMISSION`,
            text: cleanedMessage,
            createdAt: new Date().toISOString()
        };

        gameState.overseerInbox.unshift(transmission);
        if (gameState.overseerInbox.length > 100) {
            gameState.overseerInbox = gameState.overseerInbox.slice(0, 100);
        }

        scheduleAutoSave();
        res.json({ success: true, message: 'Transmission sent to Overseer', transmission });
    });

    app.post('/api/player/:player/scrap/:type', (req, res) => {
        const { player, type } = req.params;
        const { amount } = req.body;
        const gameState = getGameState();

        const amountValidation = validateNumber(amount, { min: -999, max: 999, integer: true, label: 'amount' });
        if (!amountValidation.ok) {
            return res.status(400).json({ error: amountValidation.error });
        }

        if (gameState.players[player] && gameState.players[player].scrap[type] !== undefined) {
            gameState.players[player].scrap[type] += amountValidation.value;
            scheduleAutoSave();
            res.json({ success: true, amount: gameState.players[player].scrap[type] });
        } else {
            res.status(404).json({ error: 'Player or scrap type not found' });
        }
    });

    app.post('/api/player/:player/scrap/multi', (req, res) => {
        const { player } = req.params;
        const { scrapMap } = req.body;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const allowedScrapKeys = Object.keys(gameState.players[player].scrap || {});
        const scrapValidation = validateNumericRecord(scrapMap, {
            allowedKeys: allowedScrapKeys,
            min: 1,
            max: 999,
            integer: true,
            label: 'scrapMap'
        });

        if (!scrapValidation.ok) {
            return res.status(400).json({ error: scrapValidation.error });
        }

        const playerScrap = gameState.players[player].scrap;
        let totalGranted = 0;

        Object.entries(scrapMap).forEach(([type, amount]) => {
            playerScrap[type] += amount;
            totalGranted += amount;
        });

        scheduleAutoSave();
        res.json({ success: true, totalGranted, scrap: playerScrap });
    });

    app.post('/api/player/:player/complete-quest', (req, res) => {
        const { player } = req.params;
        const { questId } = req.body;
        const gameState = getGameState();
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

    app.post('/api/player/:player/perk/:perkId', (req, res) => {
        const { player, perkId } = req.params;
        const gameState = getGameState();

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

    app.delete('/api/player/:player/perk/:perkId', (req, res) => {
        const { player, perkId } = req.params;
        const gameState = getGameState();

        if (gameState.players[player]) {
            gameState.players[player].unlockedPerks = gameState.players[player].unlockedPerks.filter(p => p !== perkId);
            scheduleAutoSave();
            res.json({ success: true, message: `Perk removed from ${player}` });
        } else {
            res.status(404).json({ error: 'Player not found' });
        }
    });

    app.post('/api/player/:player/effect/:effectId', (req, res) => {
        const { player, effectId } = req.params;
        const gameState = getGameState();
        const playerData = gameState.players[player];
        const effect = gameState.statusEffects.find(e => e.id === effectId);

        if (!playerData) {
            return res.status(404).json({ error: 'Player not found' });
        }
        if (!effect) {
            return res.status(404).json({ error: 'Effect not found' });
        }

        if (!playerData.activeEffects.includes(effectId)) {
            playerData.activeEffects.push(effectId);

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

    app.delete('/api/player/:player/effect/:effectId', (req, res) => {
        const { player, effectId } = req.params;
        const gameState = getGameState();
        const effect = gameState.statusEffects.find(e => e.id === effectId);

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        gameState.players[player].activeEffects = gameState.players[player].activeEffects.filter(e => e !== effectId);

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

    app.post('/api/player/:player/craft/:recipeId', (req, res) => {
        const { player, recipeId } = req.params;
        const gameState = getGameState();

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

        const playerScrap = playerData.scrap;
        for (const ingredient of recipe.ingredients) {
            if (ingredient.type === 'propaneTank' || ingredient.type === 'syntheticSap' ||
                ingredient.type === 'maritimeMetal' || ingredient.type === 'plaidScraps' ||
                ingredient.type === 'radMeat' || ingredient.type === 'spices' ||
                ingredient.type === 'cleanWater' || ingredient.type === 'hubCircuitry') {
                if (!playerScrap[ingredient.type] || playerScrap[ingredient.type] < ingredient.amount) {
                    return res.status(400).json({ error: `Not enough ${ingredient.type}` });
                }
            }
        }

        for (const ingredient of recipe.ingredients) {
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

    app.get('/api/quarters-shop', (req, res) => {
        const gameState = getGameState();
        res.json(gameState.quarterUpgrades);
    });

    app.get('/api/player/:player/quarters', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();

        if (gameState.players[player]) {
            const playerUpgrades = gameState.players[player].purchasedUpgrades.map(upgradeId =>
                gameState.quarterUpgrades.find(u => u.id === upgradeId)
            ).filter(u => u);
            res.json(playerUpgrades);
        } else {
            res.status(404).json({ error: 'Player not found' });
        }
    });

    app.post('/api/player/:player/quarters/:upgradeId', (req, res) => {
        const { player, upgradeId } = req.params;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const upgrade = gameState.quarterUpgrades.find(u => u.id === upgradeId);
        if (!upgrade) {
            return res.status(404).json({ error: 'Upgrade not found' });
        }

        if (gameState.players[player].purchasedUpgrades.includes(upgradeId)) {
            return res.status(400).json({ error: 'Upgrade already purchased' });
        }

        if (gameState.players[player].tabs < upgrade.cost) {
            return res.status(400).json({ error: `Need ${upgrade.cost} tabs, only have ${gameState.players[player].tabs}` });
        }

        gameState.players[player].tabs -= upgrade.cost;
        gameState.players[player].purchasedUpgrades.push(upgradeId);

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

    app.get('/api/broadcast-signals', (req, res) => {
        const gameState = getGameState();
        res.json(gameState.broadcastSignals);
    });

    app.post('/api/broadcast/random', (req, res) => {
        const gameState = getGameState();

        if (!gameState.broadcastSignals || gameState.broadcastSignals.length === 0) {
            return res.status(400).json({ error: 'No broadcast signals available' });
        }

        const randomSignal = gameState.broadcastSignals[Math.floor(Math.random() * gameState.broadcastSignals.length)];

        for (const player in gameState.players) {
            gameState.players[player].activeRadio = randomSignal.id;
            gameState.players[player].activeRadioData = null;
        }

        scheduleAutoSave();
        res.json({ success: true, message: 'Broadcast sent to all players', signal: randomSignal });
    });

    app.post('/api/encounter/random', (req, res) => {
        const gameState = getGameState();

        if (!gameState.randomEncounters || gameState.randomEncounters.length === 0) {
            return res.status(400).json({ error: 'No random encounters available' });
        }

        const encounter = gameState.randomEncounters[Math.floor(Math.random() * gameState.randomEncounters.length)];

        for (const player in gameState.players) {
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

    app.post('/api/player/:player/encounter/resolve', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();
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

    app.get('/api/trades/pending', (req, res) => {
        const gameState = getGameState();
        res.json(gameState.trades);
    });

    app.get('/api/player/:player/trades', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();
        const playerTrades = gameState.trades.filter(t => t.from === player || t.to === player);
        res.json(playerTrades);
    });

    app.post('/api/player/:player/trade/offer', (req, res) => {
        const { player } = req.params;
        const { toPlayer, offeringScrap, requestingScrap } = req.body;
        const gameState = getGameState();

        if (!gameState.players[player] || !gameState.players[toPlayer]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        if (player === toPlayer) {
            return res.status(400).json({ error: 'Cannot trade with yourself' });
        }

        for (const [scrapType, amount] of Object.entries(offeringScrap)) {
            if (!gameState.players[player].scrap[scrapType] || gameState.players[player].scrap[scrapType] < amount) {
                return res.status(400).json({ error: `Not enough ${scrapType}` });
            }
        }

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

    app.post('/api/trade/:tradeId/accept', (req, res) => {
        const { tradeId } = req.params;
        const { player } = req.body;
        const gameState = getGameState();

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

        for (const [scrapType, amount] of Object.entries(trade.requestingScrap)) {
            if (!gameState.players[player].scrap[scrapType] || gameState.players[player].scrap[scrapType] < amount) {
                return res.status(400).json({ error: `Not enough ${scrapType} to complete trade` });
            }
        }

        for (const [scrapType, amount] of Object.entries(trade.offeringScrap)) {
            if (!gameState.players[trade.from].scrap[scrapType] || gameState.players[trade.from].scrap[scrapType] < amount) {
                return res.status(400).json({ error: 'Offering player no longer has required scrap' });
            }
        }

        for (const [scrapType, amount] of Object.entries(trade.offeringScrap)) {
            gameState.players[trade.from].scrap[scrapType] -= amount;
            gameState.players[player].scrap[scrapType] += amount;
        }

        for (const [scrapType, amount] of Object.entries(trade.requestingScrap)) {
            gameState.players[player].scrap[scrapType] -= amount;
            gameState.players[trade.from].scrap[scrapType] += amount;
        }

        trade.status = 'accepted';
        trade.acceptedAt = Date.now();
        scheduleAutoSave();

        res.json({ success: true, message: 'Trade accepted!', trade: trade });
    });

    app.post('/api/trade/:tradeId/reject', (req, res) => {
        const { tradeId } = req.params;
        const { player } = req.body;
        const gameState = getGameState();

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

    app.post('/api/reset', (req, res) => {
        setGameState(createInitialGameState());
        scheduleAutoSave();
        res.json({ success: true, message: 'Game data reset to initial state' });
    });
}

module.exports = registerGameplayRoutes;
