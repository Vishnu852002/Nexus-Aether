const os = require('os');

let cachedInfo = null;

async function getHardwareInfo() {
    if (cachedInfo) return cachedInfo;

    try {
        const cpus = os.cpus();
        const primaryCpu = cpus && cpus.length > 0 ? cpus[0].model : 'Unknown CPU';
        const totalMem = os.totalmem() || 0;
        const freeMem = os.freemem() || 0;

        const gpus = [];
        let primaryGpu = null;
        let recommendation = 'No distinct GPU detected — smaller models or cloud recommended';

        // Fake some basic details quickly since WMI/systeminformation hangs on this specific PC Setup
        // We will try executing PowerShell directly with a 2 second timeout to get real GPU data
        try {
            const { execSync } = require('child_process');
            // Try to get GPU name safely
            const psOutput = execSync('powershell -Command "Get-CimInstance win32_VideoController | Select-Object -ExpandProperty Name"', { timeout: 2000, encoding: 'utf-8' });
            const lines = psOutput.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            for (const model of lines) {
                if (model) {
                    let accel = 'None';
                    let vram = 0; // WMIC AdapterRAM is often wrong for discrete GPUs, so we guess based on typical names
                    const lowerModel = model.toLowerCase();
                    if (lowerModel.includes('nvidia') || lowerModel.includes('rtx') || lowerModel.includes('gtx')) {
                        accel = 'CUDA';
                        if (lowerModel.includes('5070') || lowerModel.includes('4080') || lowerModel.includes('4090')) vram = 16000;
                        else if (lowerModel.includes('3090')) vram = 24000;
                        else if (lowerModel.includes('3080') || lowerModel.includes('4070')) vram = 12000;
                        else vram = 8000;
                    } else if (lowerModel.includes('amd') || lowerModel.includes('radeon')) {
                        accel = 'ROCm';
                        vram = 8000;
                    } else if (lowerModel.includes('intel')) {
                        accel = 'Intel';
                        vram = 2000;
                    }

                    gpus.push({ model, vendor: accel === 'CUDA' ? 'NVIDIA' : (accel === 'ROCm' ? 'AMD' : 'Intel'), vram, acceleration: accel });
                }
            }
        } catch (e) {
            // Ignore WMIC errors/timeouts
        }

        if (gpus.length > 0) {
            primaryGpu = [...gpus].sort((a, b) => b.vram - a.vram)[0];
        }

        if (primaryGpu && primaryGpu.vram > 0) {
            const vram = primaryGpu.vram;
            if (vram >= 24000) {
                recommendation = 'Can run: 70B models (Q4) · Recommended: 8B–13B for fast chat';
            } else if (vram >= 12000) {
                recommendation = 'Can run: 13B models (Q4) · Recommended: 7B–8B for fast chat';
            } else if (vram >= 8000) {
                recommendation = 'Can run: 8B models (Q4) · Recommended: 3B–7B for fast chat';
            } else if (vram >= 4000) {
                recommendation = 'Can run: 3B–7B models (Q4) · Smaller models for fast chat';
            } else {
                recommendation = 'Limited VRAM — try 1B–3B models or use cloud';
            }
        }

        cachedInfo = {
            cpu: { model: primaryCpu, cores: cpus.length / 2, threads: cpus.length },
            memory: {
                total: Math.round(totalMem / (1024 * 1024 * 1024)),
                available: Math.round(freeMem / (1024 * 1024 * 1024))
            },
            gpus,
            primaryGpu,
            recommendation,
            os: { platform: os.platform(), distro: os.type(), release: os.release(), arch: os.arch() }
        };

        return cachedInfo;
    } catch (err) {
        return {
            cpu: { model: 'Unknown', cores: 0, threads: 0 },
            memory: { total: 0, available: 0 },
            gpus: [],
            primaryGpu: null,
            recommendation: 'Could not detect hardware — try cloud models',
            os: { platform: process.platform, distro: '', release: '', arch: process.arch }
        };
    }
}

function clearCache() {
    cachedInfo = null;
}

module.exports = { getHardwareInfo, clearCache };
