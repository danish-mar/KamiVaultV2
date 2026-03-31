import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import connectDB from './config/db';
import { connectPostgres } from './config/pgDb';
import { initS3 } from './config/s3Init';

const PORT = process.env.PORT || 5000;

// Connect to Databases
connectDB();
connectPostgres();
initS3();

app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});
