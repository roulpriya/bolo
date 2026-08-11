import dotenv from "dotenv";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ override: true, path: ".env.local", quiet: true });
