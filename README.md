## Punchcard

Punchcard is a TypeScript project aimed at imagining what the future of software development might look like for the Cloud. It builds on top of the [AWS Cloud Development Kit (CDK)](https://github.com/awslabs/aws-cdk), AWS's infrastructure-as-code product, adding a variety of high-level and type-safe features. 

The name punchcard comes from the idea that, as infrastructure-as-code projects mature, the technology we are used to using today will feel as ancient to us as punchcards do today. You know, those times when we were restricted to writing and sharing software on cards with holes in them ;)

Let's walk through some punchcard features to demonstrate:

### Runtime Code and Dependencies

Punchcard unifies "infrastructure code" with "runtime code" - i.e. you can declare *and* implement an AWS Lambda Function with the same code:

```ts
new Function(stack, 'MyFunction', {
  handle: async (event) => {
    console.log('hello world');
  }
});
```

To contact other services in your Function, data structures such as SNS Topics, SQS Queues, DynamoDB Tables, etc. are declared as a `Dependency`. 

This will create the required IAM policies for your Function's IAM Role, add any environment variables for details such as the Topic's ARN, and automatically create a client for accessing the `Construct`. The result is that your `handle` function is now passed a `topic` instance which you can interact with:

```ts
new Function(stack, 'MyFunction', {
  depends: topic,
  handle: async (event, topic) => {
    await topic.publish({
      key: 'some key',
      count: 1,
      timestamp: new Date()
    });
  }
});
```

Furthermore, its interface is higher-level than what would normally be expected when using the `aws-sdk`, and it's also type-safe: the argument to the `publish` method is not an opaque `string` or `Buffer`, it is an `object` with keys and rich types such as `Date`. This is because data structures in punchcard, such as `Topic`, `Queue`, `Stream`, etc. are generic with statically declared types (like an `Array<T>`):

```ts
const topic = new Topic(stack, 'Topic', {
  /**
   * Message is a JSON Object with properties: `key`, `count` and `timestamp`.
   */
  type: struct({
    key: string(),
    count: integer(),
    timestamp
  })
});
```

This `Topic` is now of type:
```ts
Topic<{
  key: string;
  count: number;
  timestamp: Date;
}>
```

This feature in punchcard becomes even more evident when using DynamoDB. To demonstrate, let's create a DynamoDB `HashTable` and use it in a `Function`:

*(by `HashTable`, we mean a DynamoDB Table with only a partitionKey and no sortKey)*

```ts
const table = new HashTable(stack, 'my-table', {
  partitionKey: 'id',
  shape: {
    id: string(),
    count: integer({
      minimum: 0
    })
  },
  billingMode: BillingMode.PAY_PER_REQUEST
});
```

Now, when getting an item from DynamoDB, there is no need to use `AttributeValues` such as `{ S: 'my string' }`, like you would when using the low-level `aws-sdk`. You simply use ordinary javascript types:

```ts
const item = await table.get({
  id: 'state'
});
```

The interface is statically typed and derived from the definition of the `HashTable` - we specified the `partitionKey` as the `id` field which has type `string`, and so the object passed to the `get` method must correspond.

`PutItem` and `UpdateItem` have similarly high-level and statically checked interfaces. More interestingly, condition and update expressions are built with helpers derived (again) from the table definition:

```ts
// put an item if it doesn't already exist
await table.put({
  item: {
    id: 'state',
    count: 1
  },
  if: item => attribute_not_exists(item.id)
});

// increment the count property by 1
await table.update({
  key: {
    id: 'state'
  },
  actions: item => [
    item.count.increment(1)
  ]
});
```

If your table is a `SortedTable`, which is a DynamoDB Table with both a `partitionKey` and a `sortKey`, then you can also build typesafe query expressions:

```ts
await table.query({
  key: {
    id: 'id',
    count: greaterThan(1)
  },
})
```
### Enumerable Data Structures

Punchcard also has the concept of `Enumerable` data structures, which should feel similar to in-memory arrays/lists because of its chainable API, including operations such as `map`, `flatMap`, `filter`, `collect` etc.

Data structures that implement `Enumerable` are: `Topic`, `Queue`, `Stream`, `Bucket` and (Glue) `Table`.

Let's look at some examples of how powerful this flow can be.

Given a SNS Topic:
```ts
const topic = new Topic(stack, 'Topic', {
  type: struct({
    key: string(),
    count: integer(),
    timestamp
  })
});
```

You can attach a new Lambda Function to process each notification:
```ts
topic.enumerable().forEach(stack, 'ForEachNotification', {
  handle: async (notification) => {
    console.log(`notification delayed by ${new Date().getTime() - notification.timestamp.getTime()}ms`);
  }
})
```

Or, create a new SQS Queue and subscribe notifications to it:

*(Messages in the `Queue` are of the same type as the notifications in the `Topic`.)*

```ts
const queue = topic.toQueue(stack, 'MyNewQueue');
```

We can then, perhaps, `map` over each message in the `Queue` and collect the results into a new AWS Kinesis `Stream`:

```ts
const stream = queue.enumerable()
  .map({
    handle: async(message, e) => {
      return {
        ...message,
        tags: ['some', 'tags'],
      };
    }
  })
  .toStream(stack, 'Stream', {
    // partition values across shards by the 'key' field
    partitionBy: value => value.key,

    // type of the data in the stream
    type: struct({
      key: string(),
      count: integer(),
      tags: array(string()),
      timestamp
    })
  });
```

With data in a `Stream`, we might want to write out all records to a new S3 `Bucket` by attaching a new Firehose `DeliveryStream` to it:

```ts
const s3DeliveryStream = stream.toS3(stack, 'ToS3');
```

With data now flowing to S3, let's partition and catalog it in a Glue `Table` (backed by a new S3 `Bucket`) so we can easily query it with AWS Athena, AWS EMR and AWS Glue:

```ts
import glue = require('@aws-cdk/aws-glue');

const database = new glue.Database(stack, 'Database', {
  databaseName: 'my_database'
});
s3DeliveryStream.toGlueTable(stack, 'ToGlue', {
  database,
  tableName: 'my_table',
  columns: stream.type.shape,
  partition: {
    // Glue Table partition keys: minutely using the timestamp field
    keys: {
      year: integer(),
      month: integer(),
      day: integer(),
      hour: integer(),
      minute: integer()
    },
    get: record => ({
      // define the mapping of a record to its Glue Table partition keys
      year: record.timestamp.getUTCFullYear(),
      month: record.timestamp.getUTCMonth(),
      day: record.timestamp.getUTCDate(),
      hour: record.timestamp.getUTCHours(),
      minute: record.timestamp.getUTCMinutes(),
    })
  }
});
```

### Conclusion

This style of programming should feel familiar - the idea is to map ordinary in-memory data structures and algorithms to the AWS Cloud. So, instead of using in-memory hash maps, you use a DynamoDB Table, and instead of an in-memory queue, it's an AWS SQS Queue, etc.

## [Examples]([examples](https://github.com/sam-goodwin/punchcard/blob/master/examples/lib))
More detailed examples can be found in the source:
* [Stream Processing](https://github.com/sam-goodwin/punchcard/blob/master/examples/lib/stream-processing.ts) - respond to SNS notifications with a Lambda Function; subscribe notifications to a SQS Queue and process them with a Lambda Function; process and forward data from a SQS Queue to a Kinesis Stream; sink records from the Stream to S3 and catalog it in a Glue Table.
* [Invoke a Function from another Function](https://github.com/sam-goodwin/punchcard/blob/master/examples/lib/invoke-function.ts) - call a Function from another Function
* [Real-Time Data Lake](https://github.com/sam-goodwin/punchcard/blob/master/examples/lib/data-lake.ts) - collects data with Kinesis and persists to S3, exposed as a Glue Table in a Glue Database.
* [Scheduled Lambda Function](https://github.com/sam-goodwin/punchcard/blob/master/examples/lib/scheduled-function.ts) - runs a Lambda Function every minute and stores data in a DynamoDB Table.
* [Pet Store API Gateway](https://github.com/sam-goodwin/punchcard/blob/master/examples/lib/pet-store-apigw.ts) - implementation of the [Pet Store API Gateway canonical example](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-create-api-from-example.html).

## Getting Started 

This library is built with (and relies on) the AWS CDK, so make sure you read their [documentation](https://docs.aws.amazon.com/cdk/latest/guide/what-is.html) first.

A punchcard application is not too different than a CDK application - the only difference is that you must export the `@aws-cdk/core.App` as `default` from your application's entry-point. Instructions below should be all that is required to get started:

Install `punchcard` and the `aws-cdk`:

```shell
npm install --save-dev aws-cdk
npm install --save @aws-cdk/core
npm install --save punchcard
```

Create an `index.ts` file to contain your application's entrypoint:

```ts
import cdk = require('@aws-cdk/cdk');
import punchcard = require('punchcard');

const app = new cdk.App();
const stack = new cdk.Stack(app, 'CronStack');

// NOTE: make sure you export the app as default, or else your code won't run at runtime
export default app;

// create and use punchcard or CDK constructs
const table = new punchcard.HashTable(stack, 'MyTable', {
  // ...
});
```

Compile your code and deploy the app with the `cdk`:

```shell
npm run build
./node_modules/aws-cdk/bin/cdk deploy -a ./index.js
```

## License

This library is licensed under the Apache 2.0 License. 
