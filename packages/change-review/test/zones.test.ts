import assert from 'node:assert/strict'
import { test } from 'node:test'
import { zoneOf } from '../src/zones.ts'

/** Path, then the zone's layer, subject, component and words. */
type Row = [path: string, layer: string, subject: string, component: string | undefined, label: string]

const check = (rows: Row[]) => {
  for (const [path, layer, subject, component, label] of rows) {
    const zone = zoneOf(path)
    assert.deepEqual(
      { layer: zone.layer, subject: zone.subject, component: zone.component, label: zone.label },
      { layer, subject, component, label },
      path,
    )
    assert.equal(zone.id, `${component ?? '-'}/${layer}/${subject}`, path)
  }
}

test('a Rails path is a layer and the subject its file names, singular, with its namespace', () => {
  check([
    ['app/controllers/orders_controller.rb', 'controller', 'order', undefined, 'Controllers · Orders'],
    ['app/controllers/admin/orders_controller.rb', 'controller', 'admin/order', undefined, 'Controllers · Admin orders'],
    ['app/models/order.rb', 'model', 'order', undefined, 'Models · Order'],
    ['app/models/order_item.rb', 'model', 'order_item', undefined, 'Models · Order item'],
    ['app/models/concerns/billable.rb', 'model', 'billable', undefined, 'Models · Billable'],
    ['app/jobs/charge_order_job.rb', 'job', 'charge_order', undefined, 'Jobs · Charge order'],
    ['app/workers/sync_worker.rb', 'job', 'sync', undefined, 'Jobs · Sync'],
    ['app/views/orders/show.html.erb', 'view', 'order', undefined, 'Views · Orders'],
    ['app/helpers/posts_helper.rb', 'helper', 'post', undefined, 'Helpers · Posts'],
    ['app/mailers/order_mailer.rb', 'mailer', 'order', undefined, 'Mailers · Order'],
    ['app/policies/order_policy.rb', 'policy', 'order', undefined, 'Policies · Order'],
    ['app/services/billing/refund_service.rb', 'service', 'billing/refund', undefined, 'Services · Billing refund'],
    ['app/serializers/order_serializer.rb', 'presenter', 'order', undefined, 'Presenters · Order'],
    ['app/channels/chat_channel.rb', 'channel', 'chat', undefined, 'Channels · Chat'],
    ['app/models/category.rb', 'model', 'category', undefined, 'Models · Category'],
    ['app/controllers/categories_controller.rb', 'controller', 'category', undefined, 'Controllers · Categories'],
    ['app/javascript/controllers/hello_controller.js', 'controller', 'hello', undefined, 'Controllers · Hello'],
    ['lib/tasks/orders.rake', 'task', 'order', undefined, 'Tasks · Orders'],
    ['db/migrate/20240101120000_add_total_to_orders.rb', 'migration', 'add_total_to_orders', undefined, 'Migrations · Add total to orders'],
    ['db/schema.rb', 'schema', 'schema', undefined, 'Database · Schema'],
    ['config/routes.rb', 'route', 'routes', undefined, 'Routes'],
    ['config/initializers/stripe.rb', 'config', 'stripe', undefined, 'Config · Stripe'],
    ['engines/billing/app/models/invoice.rb', 'model', 'invoice', 'billing', 'Billing models · Invoice'],
  ])
})

test('a path of this repository is its part of the app and the folder it is about', () => {
  check([
    ['ui/src/features/review/graph/NodeCard.tsx', 'graph', 'review', 'ui', 'Window · review graph'],
    ['ui/src/features/review/ReviewPage.tsx', 'feature', 'review', 'ui', 'Window · review'],
    ['ui/src/components/FilePath.tsx', 'component', 'components', 'ui', 'Window · components'],
    ['ui/src/components/ui/button.tsx', 'component', 'ui', 'ui', 'Window · ui components'],
    ['ui/src/avatar/pals.ts', 'ui', 'avatar', 'ui', 'Window · avatar'],
    ['host/src/review/vicinity-scan.ts', 'host', 'review', 'host', 'Host · review'],
    ['host/src/review/assessment.ts', 'host', 'review', 'host', 'Host · review'],
    ['host/src/commands.ts', 'host', 'host', 'host', 'Host'],
    ['host/src/main.ts', 'host', 'host', 'host', 'Host'],
    ['ui/src/App.tsx', 'ui', 'ui', 'ui', 'Window'],
    ['shared/review/types.ts', 'shared', 'review', 'shared', 'Shared · review'],
    ['packages/change-review/src/proof.ts', 'change-review', 'change-review', 'change-review', 'Change review'],
    ['src-tauri/src/main.rs', 'src-tauri', 'src-tauri', 'src-tauri', 'Native'],
    ['scripts/perf/motion.ts', 'scripts', 'perf', undefined, 'Scripts · Perf'],
  ])
})

test('a folder no convention names is the zone, and the folder under it the subject', () => {
  check([
    ['src/utils/date.ts', 'utils', 'utils', undefined, 'Utils'],
    ['src/handlers/reviews.js', 'handler', 'review', undefined, 'Handlers · Reviews'],
    ['src/widgets/orders.js', 'widgets', 'widgets', undefined, 'Widgets'],
    ['src/total.js', 'src', 'src', undefined, 'Source'],
    ['lib/foo.rb', 'lib', 'lib', undefined, 'Library'],
    ['lib/mygem/client.rb', 'mygem', 'mygem', undefined, 'Mygem'],
    ['README.md', 'root', 'root', undefined, 'Root'],
    ['PLAN.md', 'root', 'root', undefined, 'Root'],
    ['Gemfile', 'root', 'root', undefined, 'Root'],
    ['docs/client-api-v1.md', 'docs', 'docs', undefined, 'Docs'],
    ['docs/api/v1.md', 'docs', 'api', undefined, 'Docs · Api'],
    ['scripts/build.sh', 'scripts', 'scripts', undefined, 'Scripts'],
    ['bin/setup', 'bin', 'bin', undefined, 'Bin'],
    ['src/components/forms/Input.tsx', 'component', 'forms', undefined, 'Components · forms'],
    ['apps/web/src/pages/checkout/index.tsx', 'page', 'checkout', 'web', 'Web · checkout pages'],
    ['packages/api-client/src/index.ts', 'api-client', 'api-client', 'api-client', 'Api client'],
  ])
})

test("a file's own name is a subject only in a layer named by convention", () => {
  const sameZone = (a: string, b: string) => zoneOf(a).id === zoneOf(b).id
  // The review the user saw: a plan at the top and a page of docs, each in a zone named after its one file.
  assert.ok(sameZone('PLAN.md', 'README.md'), 'every file at the top is in one zone')
  assert.ok(sameZone('docs/client-api-v1.md', 'docs/setup.md'), 'every file right in a folder is in that folder')
  assert.ok(sameZone('src/total.js', 'src/config.js'), 'every file right under a source root is in that root')
  assert.ok(sameZone('host/src/main.ts', 'host/src/commands.ts'), "every file right in a component is in the component's own zone")
  assert.ok(!sameZone('docs/api/v1.md', 'docs/guide/v1.md'), 'a folder under one is a subject of its own')
  // Under a folder named by convention the file says what it is about, the same in each such layer.
  assert.ok(!sameZone('app/models/order.rb', 'app/models/user.rb'))
  assert.equal(zoneOf('src/services/reviews.js').subject, zoneOf('src/handlers/reviews.js').subject)
})

test('a test takes the subject of the code it mirrors, in a test layer', () => {
  check([
    ['spec/requests/orders_spec.rb', 'test:request', 'order', undefined, 'Tests · Orders requests'],
    ['spec/models/order_spec.rb', 'test:model', 'order', undefined, 'Tests · Order model'],
    ['test/models/order_test.rb', 'test:model', 'order', undefined, 'Tests · Order model'],
    ['test/controllers/admin/orders_controller_test.rb', 'test:controller', 'admin/order', undefined, 'Tests · Admin orders controller'],
    ['spec/jobs/charge_order_job_spec.rb', 'test:job', 'charge_order', undefined, 'Tests · Charge order job'],
    ['spec/system/checkout_spec.rb', 'test:system', 'checkout', undefined, 'Tests · Checkout system'],
    ['spec/support/auth_helpers.rb', 'test:support', 'support', undefined, 'Tests · support files'],
    ['test/e2e/topics.test.js', 'test:e2e', 'topic', undefined, 'Tests · Topics end to end'],
    ['test/helpers/posts.test.js', 'test:helper', 'post', undefined, 'Tests · Posts helper'],
    ['engines/billing/spec/models/invoice_spec.rb', 'test:model', 'invoice', 'billing', 'Billing tests · Invoice model'],
    ['host/test/review/assessment.test.ts', 'test:host', 'review', 'host', 'Tests · Host review'],
    ['packages/change-review/test/proof.test.ts', 'test:change-review', 'change-review', 'change-review', 'Change review tests'],
    ['ui/src/features/review/graph/NodeCard.test.tsx', 'test:graph', 'review', 'ui', 'Tests · Window review graph'],
    ['ui/test/pals.test.ts', 'test:ui', 'ui', 'ui', 'Window tests'],
    ['ui/src/App.test.tsx', 'test:ui', 'ui', 'ui', 'Window tests'],
    ['host/test/commands.test.ts', 'test:host', 'host', 'host', 'Host tests'],
    ['test/total.test.js', 'test:root', 'root', undefined, 'Tests · Root'],
    ['src/total.test.js', 'test:src', 'src', undefined, 'Tests · Source'],
    ['test/docs/links.test.ts', 'test:docs', 'docs', undefined, 'Tests · Docs'],
    ['scripts/build.test.ts', 'test:scripts', 'scripts', undefined, 'Tests · Scripts'],
    ['test/utils/date.test.ts', 'test:utils', 'utils', undefined, 'Tests · Utils'],
    ['test/scripts/perf/motion.test.ts', 'test:scripts', 'perf', undefined, 'Tests · Perf scripts'],
  ])
  // The request test and the controller share the subject, so each can be found from the other.
  assert.equal(zoneOf('spec/requests/orders_spec.rb').subject, zoneOf('app/controllers/orders_controller.rb').subject)
  assert.equal(zoneOf('host/test/review/assessment.test.ts').subject, zoneOf('host/src/review/assessment.ts').subject)
  // A test zone names the code zone it mirrors by its id, as the review's order finds it.
  const mirrored = (path: string) => {
    const zone = zoneOf(path)
    return `${zone.component ?? '-'}/${zone.layer.slice('test:'.length)}/${zone.subject}`
  }
  for (const [tested, code] of [['test/total.test.js', 'total.js'], ['src/total.test.js', 'src/total.js'], ['test/docs/links.test.ts', 'docs/links.ts'], ['host/test/commands.test.ts', 'host/src/commands.ts'], ['ui/src/App.test.tsx', 'ui/src/App.tsx']] as const) {
    assert.equal(mirrored(tested), zoneOf(code).id, tested)
  }
})

test('a part the scan calls a test is in a test zone wherever its file is', () => {
  const zone = zoneOf('app/models/order.rb', 'test')
  assert.equal(zone.layer, 'test:model')
  assert.equal(zone.subject, 'order')
  assert.equal(zone.label, 'Tests · Order model')
  assert.equal(zoneOf('app/models/order.rb', 'function').layer, 'model')
})

test('the same path gives the same zone, and a label is never a path', () => {
  const paths = ['app/controllers/admin/orders_controller.rb', 'ui/src/features/review/graph/NodeCard.tsx', 'spec/requests/orders_spec.rb', 'a/b/c/d.ts', 'x', 'src', 'host/src']
  for (const path of paths) {
    assert.deepEqual(zoneOf(path), zoneOf(path))
    assert.doesNotMatch(zoneOf(path).label, /\/|\.(rb|ts|tsx|js)\b/, path)
  }
})
