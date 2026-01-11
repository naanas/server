import Xendit from 'xendit-node';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.XENDIT_SECRET_KEY) {
    console.error("⚠️  WARNING: XENDIT_SECRET_KEY is missing in .env file");
}

const x = new Xendit({
    secretKey: process.env.XENDIT_SECRET_KEY || '',
});

export const { Invoice } = x;
export default x;