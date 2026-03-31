import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import cookieParser from 'cookie-parser';
import expressLayouts from 'express-ejs-layouts';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import { renderHome } from './controllers/userController';

const app = express();

// View engine setup
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.set('layout', 'layouts/main');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.get('/', renderHome);

export default app;
