---
name: angular-templates
description: |
  Angular 19+ component and service templates. Quick-reference code patterns.
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

# Angular Templates

All rules are in CLAUDE.md. This skill provides quick-reference code templates.

## Component Template
```typescript
@Component({
  selector: 'app-feature-name',
  template: `
    @if (data(); as items) {
      @for (item of items; track item.id) {
        <app-item [data]="item" />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ItemComponent],
})
export class FeatureNameComponent {
  readonly data = input.required<Item[]>();
  readonly selected = output<Item>();
  private readonly service = inject(FeatureService);
  readonly derived = computed(() => this.data().filter(x => x.active));
}
```

## Service Template
```typescript
@Injectable({ providedIn: 'root' })
export class FeatureService {
  private readonly request = inject(RequestService);

  getData(): Observable<Data[]> {
    return this.request.get('/api/data');
  }
}
```
