const assert = require("assert");
const { extractVideoTaskId, extractVideoTaskStatus } = require("./videoTaskUtils.cjs");

describe("video task response normalization", () => {
  test("extracts nested data.id responses", () => {
    assert.strictEqual(
      extractVideoTaskId({ data: { id: "nested-task-123", status: "queued" } }),
      "nested-task-123",
    );
  });

  test("supports common top-level and nested task id aliases", () => {
    assert.strictEqual(extractVideoTaskId({ taskId: "camel-task" }), "camel-task");
    assert.strictEqual(extractVideoTaskId({ data: { task_id: "snake-task" } }), "snake-task");
  });

  test("extracts nested task state", () => {
    assert.strictEqual(extractVideoTaskStatus({ data: { state: "in_progress" } }), "IN_PROGRESS");
  });
});
