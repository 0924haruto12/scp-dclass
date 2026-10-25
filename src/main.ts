import './style.css';
import { NeedToKnowApp } from './ui/app';

const root = document.getElementById('app');
if (root) {
  const app = new NeedToKnowApp(root);
  (window as unknown as { __NTK_APP__?: NeedToKnowApp }).__NTK_APP__ = app;
}
