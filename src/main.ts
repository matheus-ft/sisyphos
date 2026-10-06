import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

if (import.meta.env.DEV) {
  // Lets local browser scripts seed and inspect the app; builds leave it out.
  void import('./ui/app.svelte').then((state) => Object.assign(window, { __sisyphos: state.app }));
}

export default app;
