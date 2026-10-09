import { mount } from 'svelte';
import '../../src/app.css';
import Workbench from './Workbench.svelte';

mount(Workbench, { target: document.getElementById('workbench')! });
