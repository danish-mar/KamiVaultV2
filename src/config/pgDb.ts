import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: parseInt(process.env.PGPORT || '5432'),
});

const connectPostgres = async () => {
  try {
    const client = await pool.connect();
    console.log(`PostgreSQL Connected to ${process.env.PGDATABASE}`);
    client.release();
  } catch (error) {
    if (error instanceof Error) {
      console.error(`PostgreSQL Connection Error: ${error.message}`);
    } else {
      console.error('An unknown error occurred during PostgreSQL connection');
    }
    // We might not want to exit the process if PG fails but Mongo works, 
    // but for now, let's just log it.
  }
};

export { pool, connectPostgres };
