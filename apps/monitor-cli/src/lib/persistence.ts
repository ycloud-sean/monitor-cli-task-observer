import Database from "better-sqlite3";
import type { TaskEvent, TaskRecord } from "@monitor/contracts";

export class Persistence {
  #db: Database.Database;
  #applyEventTx: (event: TaskEvent, task: TaskRecord | undefined) => void;

  constructor(filePath: string) {
    this.#db = new Database(filePath);
    this.#db.exec(`
      create table if not exists tasks (
        task_id text primary key,
        json text not null
      );
      create table if not exists task_events (
        id integer primary key autoincrement,
        task_id text not null,
        type text not null,
        at text not null,
        json text not null
      );
    `);
    this.#applyEventTx = this.#db.transaction((event: TaskEvent, task: TaskRecord | undefined) => {
      this.appendEvent(event);
      if (task) this.saveTask(task);
    });
  }

  applyEvent(event: TaskEvent, task?: TaskRecord): void {
    this.#applyEventTx(event, task);
  }

  saveTask(task: TaskRecord): void {
    this.#db
      .prepare(
        "insert into tasks(task_id, json) values (?, ?) on conflict(task_id) do update set json=excluded.json"
      )
      .run(task.taskId, JSON.stringify(task));
  }

  appendEvent(event: TaskEvent): void {
    this.#db
      .prepare("insert into task_events(task_id, type, at, json) values (?, ?, ?, ?)")
      .run(event.taskId, event.type, event.at, JSON.stringify(event));
  }

  loadTasks(): TaskRecord[] {
    return this.#db
      .prepare<unknown[], { json: string }>("select json from tasks order by rowid desc")
      .all()
      .map((row: { json: string }) => JSON.parse(row.json) as TaskRecord);
  }

  close(): void {
    if (this.#db.open) this.#db.close();
  }
}
