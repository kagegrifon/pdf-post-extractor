import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { setupPwa, versionLabel } from './pwa';
import './styles.css';
import { mountApp } from './ui/app';

GlobalWorkerOptions.workerSrc = workerUrl;
const root = document.getElementById('app')!;
const app = mountApp(root);
root.querySelector('#version')!.textContent = versionLabel(__APP_VERSION__, __APP_COMMIT__);
setupPwa(
  root.querySelector<HTMLElement>('#update-banner')!,
  root.querySelector<HTMLButtonElement>('#update-btn')!,
  app.hasFiles,
);
