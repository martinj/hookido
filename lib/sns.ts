import {
	SNSClient,
	SubscribeCommand,
	SetTopicAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SetSubscriptionAttributesCommand
} from '@aws-sdk/client-sns';
import type {
	SNSClientConfig,
	SubscribeCommandOutput,
	ListSubscriptionsByTopicCommandInput,
	ListSubscriptionsByTopicCommandOutput,
	Subscription as AWSSubscription // Renaming to avoid conflict with Hapi's Subscription
} from '@aws-sdk/client-sns';
import MessageValidator from 'sns-validator';
// import type { Message } from 'sns-validator'; // Removed due to TS2305

const validator = new MessageValidator();

// Define a local interface for SNS messages
export interface SNSMessage {
	Type: string;
	MessageId: string;
	Token?: string; // Only for SubscribeURL and UnsubscribeURL
	TopicArn: string;
	Subject?: string; // Optional for notifications
	Message: string;
	SubscribeURL?: string; // Only for SubscriptionConfirmation and UnsubscribeConfirmation
	Timestamp: string;
	SignatureVersion: string;
	Signature: string;
	SigningCertURL: string; // Typo in original was SigningCertUrl
	UnsubscribeURL?: string; // Only for notifications
	MessageAttributes?: { [key: string]: { Type: string; Value: string } };
}

// Custom error class to include a 'code' property
export class SNSError extends Error { // Added export
	code?: string;
	constructor(message: string, code?: string) {
		super(message);
		this.name = 'SNSError';
		if (code) {
			this.code = code;
		}
	}
}

export default class SNS {
	private snsClient: SNSClient;

	constructor(awsConfig?: SNSClientConfig) {
		this.snsClient = new SNSClient(awsConfig || {});
	}

	async setTopicAttributes(TopicArn: string, attributes: Record<string, string>): Promise<void> {
		// Process attributes sequentially
		for (const key of Object.keys(attributes)) {
			const command = new SetTopicAttributesCommand({
				TopicArn,
				AttributeName: key,
				AttributeValue: attributes[key]
			});
			await this.snsClient.send(command);
		}
	}

	subscribe(TopicArn: string, Protocol: string, Endpoint: string): Promise<SubscribeCommandOutput> {
		const command = new SubscribeCommand({
			TopicArn,
			Protocol,
			Endpoint
		});

		return this.snsClient.send(command);
	}

	async setSubscriptionAttributes(SubscriptionArn: string, attributes: Record<string, string>): Promise<void> {
		for (const key of Object.keys(attributes)) {
			const command = new SetSubscriptionAttributesCommand({
				SubscriptionArn,
				AttributeName: key,
				AttributeValue: attributes[key]
			});
			await this.snsClient.send(command);
		}
	}

	/**
	 * Find subscription arn
	 * @param  {String} TopicArn
	 * @param  {String} Protocol
	 * @param  {String} Endpoint
	 * @param  {String} [NextToken] used for paged results
	 * @return {Promise} resolves with arn, rejects with Error using err.code = 'NOT_FOUND' if it doesnt find the subscription
	 */
	async findSubscriptionArn(TopicArn: string, Protocol: string, Endpoint: string, NextToken?: string): Promise<string | undefined> {
		const params: ListSubscriptionsByTopicCommandInput = {TopicArn};

		if (NextToken) {
			params.NextToken = NextToken;
		}

		const command = new ListSubscriptionsByTopicCommand(params);

		try {
			const data: ListSubscriptionsByTopicCommandOutput = await this.snsClient.send(command);
			if (data.Subscriptions && data.Subscriptions.length > 0) {
				const subscription = data.Subscriptions.find((sub: AWSSubscription) => {
					return sub.Protocol?.toLowerCase() === Protocol.toLowerCase() &&
						sub.Endpoint?.toLowerCase() === Endpoint.toLowerCase();
				});

				if (subscription) {
					if (subscription.SubscriptionArn === 'PendingConfirmation') {
						throw new SNSError('Subscription is pending confirmation', 'PENDING');
					}
					return subscription.SubscriptionArn;
				}
			}

			if (data.NextToken) {
				return this.findSubscriptionArn(TopicArn, Protocol, Endpoint, data.NextToken);
			} else {
				throw new SNSError(`Couldn't find subscription arn for ${Endpoint} on topic: ${TopicArn}`, 'NOT_FOUND');
			}
		} catch (error) {
			if (error instanceof SNSError) {
				throw error;
			}
			// Handle or rethrow other AWS SDK errors appropriately
			const message = error instanceof Error ? error.message : 'An unknown error occurred during findSubscriptionArn';
			throw new SNSError(message, 'AWS_SDK_ERROR');
		}
	}

	/**
	 * Validate and parse SNS request payload
	 * @param  {string | object} payload
	 * @param  {boolean} [skipValidation] if true skip AWS signature validation and only do parsing.
	 * @return {Promise<SNSMessage>} resolves with parsed json
	 */
	validatePayload(payload: string | Record<string, any>, skipValidation?: boolean): Promise<SNSMessage> {
		return new Promise((resolve, reject) => {
			let data: any;

			if (typeof payload === 'object' && payload !== null) {
				data = payload;
			} else if (typeof payload === 'string') {
				try {
					data = JSON.parse(payload);
					if (data === null || typeof data !== 'object') { // Ensure parsed data is an object
						return reject(new Error('Invalid SNS payload: Not a valid JSON object'));
					}
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					return reject(new Error(`Invalid SNS payload: ${message}`));
				}
			} else {
				return reject(new Error('Invalid SNS payload: Must be a JSON string or an object'));
			}

			if (skipValidation) {
				// When skipping validation, we assume the payload structure matches SNSMessage.
				// This is a strong assumption and might need adjustment based on use case.
				return resolve(data as SNSMessage);
			}

			validator.validate(data, (err: Error | null, message?: Record<string, unknown> | undefined) => {
				if (err) {
					return reject(err);
				}
				// Assuming message has the structure of SNSMessage.
				// This is a cast, and runtime checks might be beneficial for robustness if the
				// actual structure from sns-validator can vary or is not guaranteed by types.
				if (!message) {
					// This case should ideally not happen if err is null, but good to guard.
					return reject(new Error('Validation succeeded but message is undefined.'));
				}
				resolve(message as unknown as SNSMessage);
			});
		});
	}
}
