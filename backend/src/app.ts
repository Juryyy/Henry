import cors from 'cors';
import express, { Express } from 'express';
import router from './router';

const app: Express = express();
app.use(cors());
app.use(express.json());

app.use('/api', router);

const port = process.env.PORT || 8000;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

export default app;