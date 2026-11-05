import {
  GROCERY_CHECKOFF_DELAY_MS,
  GROCERY_CHECKOFF_REMOVE_MS,
  GroceryCheckoffController
} from "@/lib/grocery-checkoff";

describe("GroceryCheckoffController", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setup(animate = true) {
    const onCommit = jest.fn();
    const onChange = jest.fn();
    const controller = new GroceryCheckoffController(onCommit, onChange, () => animate);
    return { controller, onCommit, onChange };
  }

  it("holds a checked item for 10s, then collapses and commits", () => {
    const { controller, onCommit, onChange } = setup();
    controller.queue("milk");

    expect(controller.clock.waiting.has("milk")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(GROCERY_CHECKOFF_DELAY_MS - 1);
    expect(controller.clock.leaving.size).toBe(0);
    expect(onCommit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(controller.clock.leaving.has("milk")).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(GROCERY_CHECKOFF_REMOVE_MS);
    expect(onCommit).toHaveBeenCalledWith(["milk"]);
    expect(controller.clock.leaving.size).toBe(0);
    expect(controller.clock.waiting.size).toBe(0);
  });

  it("restarts the shared delay when another item is checked off", () => {
    const { controller, onCommit } = setup();
    controller.queue("milk");
    jest.advanceTimersByTime(9_000);
    controller.queue("eggs");

    jest.advanceTimersByTime(9_000);
    expect(controller.clock.leaving.size).toBe(0);
    expect(onCommit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);
    expect([...controller.clock.leaving]).toEqual(["milk", "eggs"]);
  });

  it("restarts the delay on any other activity and skips a re-render", () => {
    const { controller, onCommit, onChange } = setup();
    controller.queue("milk");
    jest.advanceTimersByTime(9_000);

    controller.noteActivity();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(controller.clock.hideAt).toBe(Date.now() + GROCERY_CHECKOFF_DELAY_MS);

    jest.advanceTimersByTime(9_000);
    expect(controller.clock.leaving.size).toBe(0);
    expect(onCommit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);
    expect(controller.clock.leaving.has("milk")).toBe(true);
  });

  it("pulls a collapsing row back when the user acts again", () => {
    const { controller, onCommit } = setup();
    controller.queue("milk");
    jest.advanceTimersByTime(GROCERY_CHECKOFF_DELAY_MS);
    expect(controller.clock.leaving.has("milk")).toBe(true);

    jest.advanceTimersByTime(100);
    controller.noteActivity();

    expect(controller.clock.leaving.size).toBe(0);
    expect(controller.clock.waiting.has("milk")).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(GROCERY_CHECKOFF_DELAY_MS);
    expect(controller.clock.leaving.has("milk")).toBe(true);
  });

  it("undoes one item and makes the others wait another 10s", () => {
    const { controller, onCommit } = setup();
    controller.queue("milk");
    controller.queue("eggs");
    jest.advanceTimersByTime(9_000);

    controller.drop("milk");
    expect(controller.clock.waiting.has("milk")).toBe(false);
    expect(controller.clock.waiting.has("eggs")).toBe(true);

    jest.advanceTimersByTime(9_000);
    expect(controller.clock.leaving.size).toBe(0);

    jest.advanceTimersByTime(1_000);
    expect([...controller.clock.leaving]).toEqual(["eggs"]);

    jest.advanceTimersByTime(GROCERY_CHECKOFF_REMOVE_MS);
    expect(onCommit).toHaveBeenCalledWith(["eggs"]);
  });

  it("commits without a collapse when animation is off", () => {
    const { controller, onCommit } = setup(false);
    controller.queue("milk");
    jest.advanceTimersByTime(GROCERY_CHECKOFF_DELAY_MS);

    expect(onCommit).toHaveBeenCalledWith(["milk"]);
    expect(controller.clock.leaving.size).toBe(0);
    expect(controller.clock.waiting.size).toBe(0);
  });

  it("prunes rows that left the list without restarting the delay", () => {
    const { controller, onCommit } = setup();
    controller.queue("milk");
    controller.queue("eggs");
    const hideAt = controller.clock.hideAt;
    jest.advanceTimersByTime(1_000);

    controller.prune(new Set(["eggs"]));

    expect(controller.clock.waiting.has("milk")).toBe(false);
    expect(controller.clock.waiting.has("eggs")).toBe(true);
    expect(controller.clock.hideAt).toBe(hideAt);

    jest.advanceTimersByTime(GROCERY_CHECKOFF_DELAY_MS - 1_000);
    expect(controller.clock.leaving.has("eggs")).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit after dispose", () => {
    const { controller, onCommit } = setup();
    controller.queue("milk");
    controller.dispose();
    jest.advanceTimersByTime(GROCERY_CHECKOFF_DELAY_MS + GROCERY_CHECKOFF_REMOVE_MS);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
