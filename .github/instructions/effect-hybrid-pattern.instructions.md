---
applyTo: "**/*.ts"
---

Hybrid API Pattern - First Principles
The Foundation
Single Source of Truth: Every operation has ONE implementation. We choose Effect as that implementation because it provides better composition, error handling, and testability.
Two Interfaces, One Implementation: Users can access the same logic through two different interfaces - Effect (for composition) or Promise (for simplicity).
Core Rules
Rule 1: Implementation Lives in Effect
Write your actual logic as Effect functions.
Why?

Effect handles errors as values (type-safe)
Effect composes naturally with other Effects
Effect enables dependency injection and testing
Effect provides better control flow

typescript// The actual implementation
function createEffect(params): Effect.Effect<Result, Error> {
return Effect.try({
try: () => {
// Your logic here
return result;
},
catch: (cause) => new CustomError(cause),
});
}
Rule 2: Export Effect Functions Directly
Put Effect functions in an effect namespace.
Why?

Clear API boundary: Module.effect.operation()
Users who want Effect get direct access
No wrapping, no overhead
Enables Effect-to-Effect composition

typescriptexport const effect = {
create: createEffect,
update: updateEffect,
delete: deleteEffect,
};
Rule 3: Promise API Runs the Effect
Provide convenience functions that execute the Effects.
Why?

Users who don't need Effect get simple functions
No code duplication - just execution
Same behavior, different interface
Backwards compatibility

typescriptexport function create(params): Result {
return runEffect(createEffect(params));
}
Rule 4: Effects Call Effects, Promises Call Promises
Never mix the two execution models.
Why?

Effect composition is efficient (no execution until the end)
Promise calls force immediate execution
Mixing breaks the composition model
Type safety breaks down

typescript// Effect calling Effect - CORRECT
function composedEffect(): Effect.Effect<Result, Error> {
return Effect.gen(function* () {
const a = yield* otherModuleEffect.operation(); // ✓ Composes
return a;
});
}

// Promise calling Promise - CORRECT
function composedPromise(): Result {
const a = otherModule.operation(); // ✓ Direct call
return a;
}

// Effect calling Promise - WRONG
function brokenEffect(): Effect.Effect<Result, Error> {
return Effect.gen(function\* () {
const a = otherModule.operation(); // ✗ Breaks composition
return a;
});
}
Rule 5: Errors Are Values in Effects, Exceptions in Promises
Handle errors appropriately for each interface.
Why?

Effect users expect typed errors in the signature
Promise users expect thrown exceptions
runEffect handles the conversion
No need to duplicate error handling

typescript// Effect - errors in type signature
function operationEffect(): Effect.Effect<number, MathError> {
return Effect.try({
try: () => riskyOperation(),
catch: (cause) => new MathError(cause),
});
}

// Promise - errors thrown
function operation(): number {
return runEffect(operationEffect()); // Converts Error to thrown exception
}
The Pattern in Practice
Minimal Module Structure
typescript// 1. Effect implementations (source of truth)
function opEffect(params): Effect.Effect<Result, Error> {
return Effect.try({
try: () => {
// Logic here
},
catch: (e) => new CustomError(e),
});
}

// 2. Effect namespace (direct access)
export const effect = {
op: opEffect,
};

// 3. Promise wrappers (convenience)
export function op(params): Result {
return runEffect(opEffect(params));
}
Cross-Module Composition
Effect-to-Effect (stays composed):
typescriptfunction workflowEffect(): Effect.Effect<Result, Error> {
return Effect.gen(function* () {
const a = yield* ModuleA.effect.op1();
const b = yield* ModuleB.effect.op2(a);
const c = yield* ModuleC.effect.op3(b);
return c;
}); // Nothing executes until you run this Effect
}
Promise-to-Promise (immediate execution):
typescriptfunction workflow(): Result {
const a = ModuleA.op1(); // Executes immediately
const b = ModuleB.op2(a); // Executes immediately
const c = ModuleC.op3(b); // Executes immediately
return c;
}
Decision Tree
When writing a new function:

Write the Effect version first
Add it to the effect namespace
Create Promise wrapper with runEffect

When calling another module:

In Effect code? Call OtherModule.effect.operation()
In Promise code? Call OtherModule.operation()
Never mix them

When should a user choose Effect vs Promise?

Need composition, DI, testing? → Effect API
Need simplicity, one-off calls? → Promise API
Both work, different trade-offs

Why This Works
Separation of Concerns

Implementation: Effect functions
Interface: Effect namespace + Promise wrappers
Execution: User's choice

No Duplication

Logic written once (in Effect)
Promise is just runEffect(effectVersion())
Maintenance burden is minimal

Composability

Effect users get full composability
Promise users get simplicity
Both use the same tested implementation

Type Safety

Effect signatures include error types
Promise wrappers throw exceptions
TypeScript enforces correctness

Anti-Patterns Explained
❌ Core implementation without Effect
typescriptfunction core() { /_ logic _/ }
function opEffect() { return Effect.succeed(core()); }
export function op() { return core(); }
Problem: Now you have two paths to the logic. If you need Effect features (error handling, composition), you have to refactor.
❌ Running Effects inside Effects
typescriptfunction opEffect() {
const result = runEffect(otherEffect());
return Effect.succeed(result);
}
Problem: Breaks composition. Forces immediate execution. Loses error type information.
❌ Promise calling Effect directly
typescriptfunction op() {
return Effect.gen(function* () {
return yield* opEffect();
});
}
Problem: Returns an Effect, not a Promise result. Wrong return type. User expects immediate value.
Summary

Implementation = Effect (source of truth)
Export = effect namespace (direct access)
Convenience = Promise wrappers (run the Effect)
Composition = same world (Effect→Effect, Promise→Promise)
Errors = appropriate to interface (typed in Effect, thrown in Promise)
