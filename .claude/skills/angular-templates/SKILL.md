---
name: angular-templates
description: |
  Angular 20+ component, service, and resource templates. Quick-reference code patterns
  using signals, standalone components, new control flow, and resource()/httpResource().
  Triggers on "create component", "add service", "new Angular feature".
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
---

# Angular Templates (Angular 20+)

All rules are in CLAUDE.md. This skill provides quick-reference code templates for Angular 20+.

> rohan_ui runs Angular 20.3. Use these shapes for all new components and services.

## Component (signal inputs/outputs, OnPush, new control flow)

```typescript
import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';

@Component({
  selector: 'app-feature-name',
  // standalone defaults to true in v20+ — omit unless intentionally false (e.g. NgModule app)
  imports: [ItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let activeItems = derived();
    @if (activeItems.length) {
      @for (item of activeItems; track item.id) {
        <app-item [data]="item" (selected)="selected.emit($event)" />
      }
    } @else {
      <p>No items</p>
    }
  `,
})
export class FeatureNameComponent {
  readonly data = input.required<Item[]>();
  readonly filter = input<string>('');
  readonly selected = output<Item>();

  private readonly service = inject(FeatureService);
  readonly derived = computed(() =>
    this.data().filter(x => x.active && x.name.includes(this.filter()))
  );
}
```

## Component with model() (two-way binding)

```typescript
@Component({
  selector: 'app-toggle',
  template: `<button (click)="checked.set(!checked())">{{ checked() ? 'On' : 'Off' }}</button>`,
})
export class ToggleComponent {
  readonly checked = model.required<boolean>();
}
// Parent: <app-toggle [(checked)]="enabled" />
```

## Service Template (signal state)

```typescript
@Injectable({ providedIn: 'root' })
export class FeatureService {
  private readonly request = inject(RequestService);

  private readonly _items = signal<Item[]>([]);
  readonly items = this._items.asReadonly();

  loadItems(): void {
    this.request.get<Item[]>('/api/items').subscribe(items => this._items.set(items));
  }
}
```

## Async data — HttpClient (with toSignal() for class-side access; async pipe is fine in templates)

```typescript
@Component({...})
export class UserDetailComponent {
  readonly userId = input.required<string>();
  private readonly http = inject(HttpClient);

  readonly user = toSignal(
    toObservable(this.userId).pipe(
      switchMap(id => this.http.get<User>(`/api/users/${id}`))
    ),
    { initialValue: null },
  );
}
```

## Signal queries (replace @ViewChild / @ContentChild)

```typescript
readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
readonly tabs = contentChildren(TabComponent);

focusInput(): void {
  this.input().nativeElement.focus();
}
```

## Bootstrap (zoneless, v20+ default for new apps)

```typescript
// main.ts
bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withViewTransitions()),
    provideHttpClient(withFetch()),
  ],
});
```

## Host bindings via metadata (preferred over decorators)

```typescript
@Component({
  selector: 'app-card',
  host: {
    'class': 'card',
    '[class.active]': 'active()',
    '(click)': 'onClick($event)',
  },
  template: `...`,
})
export class CardComponent {
  readonly active = input(false);
  onClick(e: MouseEvent) {}
}
```
