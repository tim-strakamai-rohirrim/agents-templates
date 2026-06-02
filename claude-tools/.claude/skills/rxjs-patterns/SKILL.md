---
name: rxjs-patterns
description: |
  RxJS patterns for Angular applications.
  Use when working with Observables, managing subscriptions, or handling async data flows.
  Triggers when user works with "observables", "subscriptions", "rxjs", "async data", "streaming", or similar.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
---

# RxJS Patterns for Rohan UI

Use context7 for latest RxJS patterns. See CLAUDE.md for Context7 usage.

## Subscription Management (takeUntilDestroyed)

```typescript
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({...})
export class FeatureComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dataService = inject(DataService);

  ngOnInit(): void {
    this.dataService.getData()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(data => this.handleData(data));
  }
}
```

## Service State with BehaviorSubject

```typescript
@Injectable({ providedIn: 'root' })
export class StateService {
  private readonly dataSubject = new BehaviorSubject<Data | null>(null);
  private readonly loadingSubject = new BehaviorSubject<boolean>(false);

  readonly data$ = this.dataSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();

  // For Angular 16+ signals interop
  readonly data = toSignal(this.data$);
  readonly loading = toSignal(this.loading$);
}
```

## Combining Streams

```typescript
// combineLatest - emits when any source emits (after all have emitted once)
const combined$ = combineLatest([this.user$, this.settings$]).pipe(
  map(([user, settings]) => ({ user, settings }))
);

// forkJoin - emits once when all complete (parallel HTTP requests)
const allData$ = forkJoin({
  users: this.http.get<User[]>('/api/users'),
  projects: this.http.get<Project[]>('/api/projects'),
});

// switchMap - cancel previous, use latest (search/typeahead)
const searchResults$ = this.searchTerm$.pipe(
  debounceTime(300),
  distinctUntilChanged(),
  filter(term => term.length >= 3),
  switchMap(term => this.searchService.search(term))
);
```

## Streaming/SSE Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class StreamingService {
  private abortController: AbortController | null = null;

  streamResponse(prompt: string): Observable<StreamChunk> {
    return new Observable(observer => {
      this.abortController = new AbortController();
      const eventSource = new EventSource(`/api/stream?prompt=${encodeURIComponent(prompt)}`);
      eventSource.onmessage = (event) => observer.next(JSON.parse(event.data));
      eventSource.onerror = (error) => { observer.error(error); eventSource.close(); };
      return () => { eventSource.close(); this.abortController?.abort(); };
    });
  }
}
```

## Form Value Changes

```typescript
this.searchControl.valueChanges.pipe(
  startWith(this.searchControl.value),
  debounceTime(300),
  distinctUntilChanged(),
  takeUntilDestroyed(this.destroyRef)
).subscribe(value => this.onSearch(value));
```

## Observable ↔ Signal Conversion

```typescript
// Observable to Signal
readonly data = toSignal(this.dataService.data$, { initialValue: [] });

// Signal to Observable
readonly filter = signal('');
readonly filter$ = toObservable(this.filter);
```

## Subject Types

| Subject | Use Case |
|---------|----------|
| `Subject` | Multicast, no initial value |
| `BehaviorSubject` | State management, has current value |
| `ReplaySubject` | Late subscribers need history |
| `AsyncSubject` | Only emit final value on complete |
