'use strict';

const Homey = require('homey');
const runSpeedTest = require('./lib/speedtest');

class FastSpeedtestApp extends Homey.App {
    async onInit() {
        this.log('Fast.com Speedtest app is running...');

        // Last known results — used by condition cards
        this.lastResult = {
            download: null,
            upload: null,
            location: null,
            speedType: null,
            timestamp: null // ms since epoch, set when lastResult is updated
        };

        this.lastResultTimestampRaw = null; // Keep raw timestamp for age calculations in condition cards

        this.speedTestActive = false;

        await this._registerFlowCards();
    }

    // ─── Flow cards ───────────────────────────────────────────────────────────

    async _registerFlowCards() {
        // ── Actions ───────────────────────────────────────────────────────────
        this.homey.flow.getActionCard('run_speedtest').registerRunListener(async () => this.runSpeedTest());

        this.homey.flow.getActionCard('run_speedtest_advanced').registerRunListener(async () => this.runSpeedTest());

        this.homey.flow.getActionCard('run_download_only').registerRunListener(async () => this.runSpeedTest({ download: true, upload: false }));
        this.homey.flow.getActionCard('run_download_only_advanced').registerRunListener(async () => this.runSpeedTest({ download: true, upload: false }));

        this.homey.flow.getActionCard('run_upload_only').registerRunListener(async () => this.runSpeedTest({ download: false, upload: true }));
        this.homey.flow.getActionCard('run_upload_only_advanced').registerRunListener(async () => this.runSpeedTest({ download: false, upload: true }));

        // ── Conditions ────────────────────────────────────────────────────────
        this.homey.flow.getConditionCard('download_above').registerRunListener(async (args, state) => this.checkSpeedConditions(this.lastResult.download, args, true));
        this.homey.flow.getConditionCard('download_below').registerRunListener(async (args, state) => this.checkSpeedConditions(this.lastResult.download, args, false));
        this.homey.flow.getConditionCard('upload_above').registerRunListener(async (args, state) => this.checkSpeedConditions(this.lastResult.upload, args, true));
        this.homey.flow.getConditionCard('upload_below').registerRunListener(async (args, state) => this.checkSpeedConditions(this.lastResult.upload, args, false));

        this.homey.flow.getConditionCard('location_is').registerRunListener(async (args) => {
            if (this.lastResult.location === null) {
                throw new Error(this.homey.__('errors.no_result_yet'));
            }
            return this.lastResult.location.toLowerCase().includes(args.location.toLowerCase());
        });

        this.homey.flow.getConditionCard('last_test_age_below').registerRunListener(async (args) => {
            if (this.lastResultTimestampRaw === null) {
                throw new Error(this.homey.__('errors.no_result_yet'));
            }

            const ageMinutes = (Date.now() - this.lastResultTimestampRaw) / 60000;
            return ageMinutes < args.minutes;
        });

        this.homey.flow.getConditionCard('last_test_age_above').registerRunListener(async (args) => {
            if (this.lastResultTimestampRaw === null) {
                throw new Error(this.homey.__('errors.no_result_yet'));
            }

            const ageMinutes = (Date.now() - this.lastResultTimestampRaw) / 60000;
            return ageMinutes > args.minutes;
        });
    }

    async checkSpeedConditions(speedToCheck, args, isAbove) {
        if (speedToCheck === null) {
            throw new Error(this.homey.__('errors.no_result_yet'));
        }

        

        const speedType = args.speedType;
        const convertedSpeedToCheck = speedType === 'gbps' ? speedToCheck / 1000 : speedToCheck; // Convert to Gbps if needed

        const condition = isAbove ? convertedSpeedToCheck > args.speed : convertedSpeedToCheck < args.speed;

        this.log('checkSpeedConditions', {
            speedType,
            speedToCheck,
            convertedSpeedToCheck,
            speedArg: args.speed,
            isAbove
        });

        return condition;
    }

    /**
     * @param {{ download?: boolean, upload?: boolean }} opts
     */
    async runSpeedTest(opts = {}) {
        const { download: runDownload = true, upload: runUpload = true } = opts;

        if (this.speedTestActive) {
            throw new Error(this.homey.__('errors.already_running'));
        }

        try {
            this.speedTestActive = true;

            // Give the connection a moment to stabilise
            await this._sleep(1000);

            const results = await runSpeedTest(runDownload, runUpload, this.log.bind(this), 2, Homey.env.TOKEN);
            this.log('run_speedtest results:', results);

            const location = results.location ? `${results.location.city}, ${results.location.country}` : 'Unknown';
            const tz = this.homey.clock.getTimezone();
            const formattedTimestamp = new Date(results.timestamp).toLocaleString('en-GB', { timeZone: tz });

            // Persist for condition cards
            this.lastResult = {
                ...results,
                location,
                timestamp: formattedTimestamp
            };

            this.lastResultTimestampRaw = results.timestamp; // Keep raw timestamp for age calculations

            this.log(`Speedtest completed`, { ...this.lastResult, rawTimestamp: this.lastResultTimestampRaw });

            // Fire the "speedtest completed" trigger
            await this.homey.flow.getTriggerCard('speedtest_completed').trigger(this.lastResult);

            return this.lastResult;
        } catch (err) {
            this.error('Speedtest failed:', err);

            // Fire the "speedtest failed" trigger so users can build alerting flows
            this.homey.flow
                .getTriggerCard('speedtest_failed')
                .trigger({ reason: err.message || String(err) })
                .catch((triggerErr) => this.error('Failed to fire speedtest_failed:', triggerErr));

            throw err;
        } finally {
            this.speedTestActive = false;
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = FastSpeedtestApp;
