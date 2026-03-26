const db = require('./database');
const cloudinary = require('cloudinary').v2;
const cron = require('node-cron');

/**
 * Export all tables as JSON and upload to Cloudinary as a backup.
 * Runs every 2 days automatically via node-cron.
 */
async function runBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    console.log(`[Backup] Starting database backup at ${timestamp}...`);

    try {
        const tables = [
            'career_applications',
            'general_enquiries',
            'product_enquiries',
            'admins'
        ];

        const backupData = {};

        for (const table of tables) {
            try {
                const [rows] = await db.query(`SELECT * FROM ${table}`);
                backupData[table] = rows;
                console.log(`[Backup] ${table}: ${rows.length} rows`);
            } catch (err) {
                console.error(`[Backup] Failed to export ${table}:`, err.message);
                backupData[table] = { error: err.message };
            }
        }

        const jsonBackup = JSON.stringify(backupData, null, 2);
        const fileName = `db-backup-${timestamp}.json`;

        // Upload to Cloudinary as a raw file
        const result = await cloudinary.uploader.upload(
            `data:application/json;base64,${Buffer.from(jsonBackup).toString('base64')}`,
            {
                folder: 'sajjalashree/backups',
                public_id: fileName.replace('.json', ''),
                resource_type: 'raw',
                type: 'authenticated'
            }
        );

        console.log(`[Backup] ✅ Backup uploaded successfully: ${result.public_id}`);
        return { success: true, public_id: result.public_id, timestamp };
    } catch (err) {
        console.error('[Backup] ❌ Backup failed:', err.message);
        return { success: false, error: err.message, timestamp };
    }
}

// Schedule backup every 2 days at 2:00 AM
function startBackupScheduler() {
    cron.schedule('0 2 */2 * *', () => {
        runBackup();
    });
    console.log('[Backup] Scheduler started — runs every 2 days at 2:00 AM');
}

module.exports = { runBackup, startBackupScheduler };
