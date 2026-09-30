import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { setupPwa } from './pwa';
import './styles.css';
import { mountApp } from './ui/app';

GlobalWorkerOptions.workerSrc = workerUrl;
const root = document.getElementById('app')!;
mountApp(root);
root.querySelector('#version')!.textContent = `Версия ${__APP_VERSION__}`;
setupPwa(root.querySelector<HTMLElement>('#update-banner')!, root.querySelector<HTMLButtonElement>('#update-btn')!);
