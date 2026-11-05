import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import todosFeature, {
  insertTodo,
  getActiveUserTodos,
  getTodoByNumber,
  markTodoDone,
  deleteTodo,
} from '../src/features/todos.js';

describe('To-Do List Feature (F-11)', () => {
  const db = getDb();
  const testUserId = 770011;

  it('menambah dan menampilkan to-do dengan penomoran urut per user', () => {
    db.prepare('DELETE FROM todos WHERE user_id = ?').run(testUserId);

    insertTodo({ userId: testUserId, text: 'Beli susu' });
    insertTodo({ userId: testUserId, text: 'Cuci baju' });
    insertTodo({ userId: testUserId, text: 'Belajar Node.js' });

    const active = getActiveUserTodos(testUserId);
    assert.equal(active.length, 3);
    assert.equal(active[0].text, 'Beli susu');
    assert.equal(active[1].text, 'Cuci baju');
    assert.equal(active[2].text, 'Belajar Node.js');

    // Penomoran per user (1-indexed)
    const item1 = getTodoByNumber(testUserId, 1);
    assert.ok(item1);
    assert.equal(item1.todo.text, 'Beli susu');

    const item3 = getTodoByNumber(testUserId, 3);
    assert.ok(item3);
    assert.equal(item3.todo.text, 'Belajar Node.js');

    // Nomor di luar batas
    assert.equal(getTodoByNumber(testUserId, 4), null);
    assert.equal(getTodoByNumber(testUserId, 0), null);
  });

  it('menandai to-do selesai (/done) dan nomor urut tampilan konsisten', () => {
    // Selesaikan to-do nomor 2 ("Cuci baju")
    const match2 = getTodoByNumber(testUserId, 2);
    assert.ok(match2);
    markTodoDone(match2.todo.id);

    // Sekarang hanya tersisa 2 to-do aktif
    const remaining = getActiveUserTodos(testUserId);
    assert.equal(remaining.length, 2);
    assert.equal(remaining[0].text, 'Beli susu'); // Sekarang nomor 1
    assert.equal(remaining[1].text, 'Belajar Node.js'); // Sekarang nomor 2 (bukan ID global)

    const newItem2 = getTodoByNumber(testUserId, 2);
    assert.equal(newItem2.todo.text, 'Belajar Node.js');
  });

  it('menghapus to-do (/deltodo)', () => {
    const match1 = getTodoByNumber(testUserId, 1);
    deleteTodo(match1.todo.id);

    const remaining = getActiveUserTodos(testUserId);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].text, 'Belajar Node.js');
  });

  it('perintah /todo dengan @waktu membuat to-do sekaligus pengingat di F-10', async () => {
    const userWithDue = 770022;
    db.prepare('DELETE FROM todos WHERE user_id = ?').run(userWithDue);
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(userWithDue);

    let capturedReply = '';
    const ctx = {
      chat: { id: userWithDue },
      from: { id: userWithDue },
      message: { text: '/todo beli beras @besok 07:00' },
      reply: async (text) => {
        capturedReply = text;
      },
    };

    const todoCmd = todosFeature.commands.find((c) => c.name === 'todo');
    assert.ok(todoCmd);

    await todoCmd.handler(ctx);

    // Cek di tabel todos
    const activeTodos = getActiveUserTodos(userWithDue);
    assert.equal(activeTodos.length, 1);
    assert.equal(activeTodos[0].text, 'beli beras');
    assert.ok(activeTodos[0].due_at > Date.now());

    // Cek otomatis masuk ke tabel reminders
    const reminders = db
      .prepare('SELECT * FROM reminders WHERE user_id = ?')
      .all(userWithDue);
    assert.equal(reminders.length, 1);
    assert.ok(reminders[0].text.includes('beli beras'));
    assert.equal(reminders[0].due_at, activeTodos[0].due_at);
  });

  it('tag [TODO_ADD: ...] menambahkan to-do', async () => {
    const tagUser = 770033;
    db.prepare('DELETE FROM todos WHERE user_id = ?').run(tagUser);

    const ctx = {
      chat: { id: tagUser },
      from: { id: tagUser },
      reply: async () => {},
    };

    const addTag = todosFeature.tags.find((t) => t.name === 'TODO_ADD');
    assert.ok(addTag);

    await addTag.handle(ctx, ['ganti oli motor']);

    const todos = getActiveUserTodos(tagUser);
    assert.equal(todos.length, 1);
    assert.equal(todos[0].text, 'ganti oli motor');
  });

  it('tag [TODO_DONE: ...] mencocokkan kata kunci secara fuzzy', async () => {
    const tagUser = 770044;
    db.prepare('DELETE FROM todos WHERE user_id = ?').run(tagUser);

    insertTodo({ userId: tagUser, text: 'Beli obat batuk' });
    insertTodo({ userId: tagUser, text: 'Beli apel merah' });

    let replyMsg = '';
    const ctx = {
      chat: { id: tagUser },
      from: { id: tagUser },
      reply: async (text) => {
        replyMsg = text;
      },
    };

    const doneTag = todosFeature.tags.find((t) => t.name === 'TODO_DONE');
    assert.ok(doneTag);

    // 1. Cocok persis 1 item via kata kunci "batuk"
    await doneTag.handle(ctx, ['batuk']);
    assert.ok(replyMsg.includes('Beli obat batuk'));

    const remaining = getActiveUserTodos(tagUser);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].text, 'Beli apel merah');

    // 2. Jika ada lebih dari satu kecocokan (misal "Beli")
    insertTodo({ userId: tagUser, text: 'Beli jeruk manis' });
    await doneTag.handle(ctx, ['Beli']);
    assert.ok(replyMsg.includes('Ada beberapa to-do yang cocok'));
    assert.ok(replyMsg.includes('/done'));
  });

  it('callback todo:done dan todo:del bekerja melalui tombol inline', async () => {
    const cbUser = 770055;
    db.prepare('DELETE FROM todos WHERE user_id = ?').run(cbUser);

    const id1 = insertTodo({ userId: cbUser, text: 'Tugas satu' });
    const id2 = insertTodo({ userId: cbUser, text: 'Tugas dua' });

    const cbHandler = todosFeature.callbacks.find((cb) => cb.prefix === 'todo:');
    assert.ok(cbHandler);

    // Selesaikan tugas 1
    const doneCtx = {
      from: { id: cbUser },
      callbackQuery: { data: `todo:done:${id1}` },
      answerCallbackQuery: async () => {},
      editMessageText: async () => {},
    };
    await cbHandler.handler(doneCtx);

    let active = getActiveUserTodos(cbUser);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, id2);

    // Hapus tugas 2
    const delCtx = {
      from: { id: cbUser },
      callbackQuery: { data: `todo:del:${id2}` },
      answerCallbackQuery: async () => {},
      editMessageText: async () => {},
    };
    await cbHandler.handler(delCtx);

    active = getActiveUserTodos(cbUser);
    assert.equal(active.length, 0);
  });
});

