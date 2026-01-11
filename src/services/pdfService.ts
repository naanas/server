import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';

/**
 * Helper untuk mencari Path Google Chrome di komputer lokal (Windows/Mac)
 * Berguna saat testing di localhost karena @sparticuz/chromium hanya jalan di Vercel/AWS.
 */
const getLocalChromePath = () => {
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Windows
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', // Windows (x86)
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // Mac
        '/usr/bin/google-chrome', // Linux
        '/usr/bin/chromium-browser' // Linux
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
};

export const generatePdfBuffer = async (htmlContent: string): Promise<Buffer> => {
    let browser;
    try {
        // Cek apakah jalan di Vercel atau Local
        // Biasanya Vercel set env var AWS_LAMBDA_FUNCTION_VERSION atau VERCEL
        const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION;

        let launchOptions: any = {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--hide-scrollbars', '--disable-web-security'],
            ignoreHTTPSErrors: true,
        };

        if (isVercel) {
            // KONFIGURASI VERCEL (Production)
            // Kita cast 'as any' untuk menghindari error TypeScript yang rewel soal properti chromium
            const chromiumAny = chromium as any;
            
            // Setup font helper (opsional, agar font terbaca)
            // await chromium.font('https://raw.githack.com/googlei18n/noto-emoji/master/fonts/NotoColorEmoji.ttf');

            launchOptions = {
                ...launchOptions,
                args: [...chromiumAny.args, ...launchOptions.args],
                defaultViewport: chromiumAny.defaultViewport,
                executablePath: await chromiumAny.executablePath(),
                headless: chromiumAny.headless,
            };
        } else {
            // KONFIGURASI LOKAL (Development)
            const localPath = getLocalChromePath();
            if (!localPath) {
                throw new Error("Google Chrome tidak ditemukan di komputer ini. Install Chrome untuk testing lokal.");
            }
            
            launchOptions = {
                ...launchOptions,
                executablePath: localPath,
                headless: true, // Gunakan boolean biasa untuk lokal
                channel: 'chrome' 
            };
        }

        browser = await puppeteer.launch(launchOptions);

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
        });

        await browser.close();
        return Buffer.from(pdfBuffer);

    } catch (error) {
        console.error("PDF Gen Error:", error);
        if (browser) await browser.close();
        throw error;
    }
};