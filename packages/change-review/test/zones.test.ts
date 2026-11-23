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
    ['host/src/commands.ts', 'host', 'commands', 'host', 'Host · commands'],
    ['shared/review/types.ts', 'shared', 'review', 'shared', 'Shared · review'],
    ['packages/change-review/src/proof.ts', 'change-review', 'proof', 'change-review', 'Change review · proof'],
    ['src-tauri/src/main.rs', 'src-tauri', 'main', 'src-tauri', 'Native · main'],
    ['scripts/perf/motion.ts', 'scripts', 'perf', undefined, 'Scripts · Perf'],
  ])
})

test('a generic folder is the layer, and what is under it the subject', () => {
  check([
    ['src/utils/date.ts', 'utils', 'date', undefined, 'Utils · Date'],
    ['src/handlers/reviews.js', 'handler', 'review', undefined, 'Handlers · Reviews'],
    ['src/widgets/orders.js', 'widgets', 'order', undefined, 'Widgets · Orders'],
    ['src/total.js', 'src', 'total', undefined, 'Source · total'],
    ['lib/mygem/client.rb', 'mygem', 'client', undefined, 'Mygem · Client'],
    ['README.md', 'root', 'README', undefined, 'Top level · README'],
    ['src/components/forms/Input.tsx', 'component', 'forms', undefined, 'Components · forms'],
    ['apps/web/src/pages/checkout/index.tsx', 'page', 'checkout', 'web', 'Web · checkout pages'],
    ['packages/api-client/src/index.ts', 'api-client', 'index', 'api-client', 'Api client · index'],
  ])
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
    ['packages/change-review/test/proof.test.ts', 'test:change-review', 'proof', 'change-review', 'Tests · Change review proof'],
    ['ui/src/features/review/graph/NodeCard.test.tsx', 'test:graph', 'review', 'ui', 'Tests · Window review graph'],
    ['ui/test/pals.test.ts', 'test:ui', 'pals', 'ui', 'Tests · Window pals'],
    ['test/total.test.js', 'test:root', 'total', undefined, 'Tests · total'],
    ['test/utils/date.test.ts', 'test:utils', 'date', undefined, 'Tests · Date utils'],
  ])
  // The request test and the controller share the subject, so each can be found from the other.
  assert.equal(zoneOf('spec/requests/orders_spec.rb').subject, zoneOf('app/controllers/orders_controller.rb').subject)
  assert.equal(zoneOf('host/test/review/assessment.test.ts').subject, zoneOf('host/src/review/assessment.ts').subject)
})

test('a folder\'s file names its subject by one rule, whether the folder is named by convention or not', () => {
  for (const folder of ['services', 'handlers', 'widgets']) {
    const zone = zoneOf(`src/${folder}/reviews.js`)
    assert.equal(zone.subject, 'review', folder)
    assert.match(zone.label, / · Reviews$/, folder)
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
  const paths = ['app/controllers/admin/orders_controller.rb', 'ui/src/features/review/graph/NodeCard.tsx', 'spec/requests/orders_spec.rb', 'a/b/c/d.ts', 'x']
  for (const path of paths) {
    assert.deepEqual(zoneOf(path), zoneOf(path))
    assert.doesNotMatch(zoneOf(path).label, /\/|\.(rb|ts|tsx|js)\b/, path)
  }
})
