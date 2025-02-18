import core = require('@aws-cdk/core');

import { Type } from '../shape/types/type';
import { S3DeliveryStreamCollector, S3DeliveryStreamForType } from './delivery-stream';
import { Enumerable } from './enumerable';
import { QueueCollector, QueueProps } from './queue';
import { StreamCollector, StreamProps } from './stream';
import { TopicCollector, TopicProps } from './topic';

/**
 * Collects data from an `Enumerable`.
 *
 * @param T type of collected result
 * @param E source enumerable
 */
export interface Collector<T, E extends Enumerable<any, any, any, any>> {
  /**
   * Create constructs to collect data from the enumerable an
   */
  collect(scope: core.Construct, id: string, enumerable: E): T
}

/**
 * Collection of default collectors.
 */
export namespace Collectors {
  /**
   * Collects data from an `Enumerable` into a new SQS Queue.
   *
   * @param props queue properties
   */
  export function toQueue<T extends Type<any>>(props: QueueProps<T>): QueueCollector<T, any> {
    return new QueueCollector<T, any>(props);
  }

  /**
   * Collects data from an `Enumerable` into a new Kinesis Stream.
   *
   * @param props stream properties
   */
  export function toStream<T extends Type<any>>(props: StreamProps<T>): StreamCollector<T, any> {
    return new StreamCollector<T, any>(props);
  }

  /**
   * Collects data from an `Enumerable` into S3 via a Firehose Delivery Stream.
   *
   * @param props stream properties
   */
  export function toS3DeliveryStream<T extends Type<any>>(props: S3DeliveryStreamForType<T>): S3DeliveryStreamCollector<T, any> {
    return new S3DeliveryStreamCollector<T, any>(props);
  }

  /**
   * Collects data from an `Enumerable` into a new SNS Topic.
   *
   * @param props topic properties
   */
  export function toTopic<T extends Type<any>>(props: TopicProps<T>): TopicCollector<T, any> {
    return new TopicCollector<T, any>(props);
  }
}