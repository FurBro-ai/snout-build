import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { DownloadPage } from './pages/DownloadPage.tsx';
import './index.css';
import { applySavedTheme } from './theme/themeStore.ts';

applySavedTheme();
const isDownloadRoute = window.location.pathname.replace(/\/+$/, '') === '/download';
createRoot(document.getElementById('root')!).render(isDownloadRoute ? <DownloadPage /> : <App />);
