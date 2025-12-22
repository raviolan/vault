import { getAppState, setAppState } from '../../miniapps/state.js';
import { escapeHtml } from '../../lib/dom.js';

const APP_ID = 'todo';

export const TodoApp = {
  id: APP_ID,
  title: 'To-Do',
  surfaces: ['rightPanel'],
  mount(rootEl, ctx) {
    const input = (rootEl || document).querySelector('#todoInput');
    const addBtn = (rootEl || document).querySelector('#todoAdd');
    const list = (rootEl || document).querySelector('#todoList');
    if (!list) return () => {};

    let todos = Array.isArray(getAppState(APP_ID, [])) ? getAppState(APP_ID, []).slice() : [];

    function render() {
      list.innerHTML = '';
      for (const t of todos) {
        const li = document.createElement('li');
        li.innerHTML = `
          <label style="display:flex; gap:8px; align-items:center;">
            <input type="checkbox" ${t.done ? 'checked' : ''} />
            <span>${escapeHtml(t.text)}</span>
          </label>
          <button class="chip" title="Delete">×</button>
        `;
        const cb = li.querySelector('input');
        const del = li.querySelector('button');
        cb.addEventListener('change', () => {
          t.done = cb.checked;
          setAppState(APP_ID, todos);
        });
        del.addEventListener('click', () => {
          todos = todos.filter(x => x.id !== t.id);
          setAppState(APP_ID, todos);
          render();
        });
        list.appendChild(li);
      }
    }

    function addTodo(text) {
      const trimmed = (text || '').trim();
      if (!trimmed) return;
      todos = [...todos, { id: crypto.randomUUID(), text: trimmed, done: false }];
      setAppState(APP_ID, todos);
      render();
    }

    const onAddClick = () => {
      addTodo(input?.value || '');
      if (input) input.value = '';
    };
    const onInputKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onAddClick();
      }
    };

    if (addBtn) addBtn.addEventListener('click', onAddClick);
    if (input) input.addEventListener('keydown', onInputKeydown);

    render();

    return () => {
      if (addBtn) addBtn.removeEventListener('click', onAddClick);
      if (input) input.removeEventListener('keydown', onInputKeydown);
      // Clear list to drop any delegated listeners
      if (list) list.innerHTML = '';
    };
  },
  unmount() {},
};

