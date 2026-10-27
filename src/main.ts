import './style.css';
import { brandMarkDataUrl } from './render/art';
import { NeedToKnowApp } from './ui/app';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (favicon) {
  favicon.type = 'image/svg+xml';
  favicon.href = brandMarkDataUrl();
}

const root = document.getElementById('app');
if (root) {
  const app = new NeedToKnowApp(root);
  (window as unknown as { __NTK_APP__?: NeedToKnowApp }).__NTK_APP__ = app;
}
