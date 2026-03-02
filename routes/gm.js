function registerGmRoutes(app, deps) {
    const {
        getStorageStatus,
        persistGameState,
        getLastSavedAt
    } = deps;

    app.get('/api/storage/status', async (req, res) => {
        const status = await getStorageStatus();
        const statusCode = status.ok ? 200 : 503;
        res.status(statusCode).json(status);
    });

    app.post('/api/storage/test-save', async (req, res) => {
        try {
            const savedAtBefore = getLastSavedAt();
            await persistGameState('manual-test', true);
            const status = await getStorageStatus();

            res.json({
                ok: true,
                message: 'Test save completed',
                savedAtBefore,
                savedAtAfter: getLastSavedAt(),
                status
            });
        } catch (error) {
            const status = await getStorageStatus();
            res.status(500).json({
                ok: false,
                error: error.message,
                status
            });
        }
    });
}

module.exports = registerGmRoutes;
