import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.js';
import scheduleRoutes from './routes/schedules.js';
import courseRoutes from './routes/courses.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth',      authRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/courses',   courseRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`UnTangle API → http://localhost:${PORT}`);
});