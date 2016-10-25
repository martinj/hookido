'use strict';

const nock = require('nock');
const expect = require('chai').expect;
const SNS = require('../../lib/sns');

describe('SNS', () => {
	let sns;

	beforeEach(() => {
		sns = new SNS({
			region: 'eu-west-1',
			accessKeyId: 'a',
			secretAccessKey: 'a'
		});
	});

	describe('#validatePayload', () => {

		it('rejects on invalid JSON', (done) => {

			sns
				.validatePayload('ada')
				.catch((err) => {
					expect(err.message).to.equal('Invalid SNS payload: Unexpected token a in JSON at position 0');
					return sns.validatePayload(null);
				})
				.catch((err) => {

					expect(err.message).to.equal('Invalid SNS payload: Not valid JSON');
					done();

				});

		});

		it('rejects on invalid payload', (done) => {

			sns
				.validatePayload('{"foo":"bar"}')
				.catch((err) => {

					expect(err.message).to.equal('Message missing required keys.');
					done();

				});

		});

		it('accepts object or array', () => {

			return sns
				.validatePayload([], true)
				.then((data) => expect(data).to.deep.equal([]))
				.then(() => sns.validatePayload({}, true))
				.then((data) => expect(data).to.deep.equal({}));

		});

		it('skipValidation skips SNS message validation only parses', () => {

			return sns
				.validatePayload('{"foo":"bar"}', true)
				.then((data) => {
					expect(data).to.deep.equal({foo: 'bar'});
				});

		});

	});

	describe('#subscribe', () => {

		afterEach(() => nock.cleanAll());

		it('sends subscribe request', () => {

			const req = nock('https://sns.eu-west-1.amazonaws.com:443')
				.post('/', 'Action=Subscribe&Endpoint=http%3A%2F%2Ffoobar.com&Protocol=HTTP&TopicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A111111111111%3Amytopic&Version=2010-03-31')
				.reply(200);

			return sns
				.subscribe('arn:aws:sns:eu-west-1:111111111111:mytopic', 'HTTP', 'http://foobar.com')
				.then(() => {

					expect(req.isDone()).to.be.true;

				});
		});

	});

	describe('#setTopicAttributes', () => {

		afterEach(() => nock.cleanAll());

		it('sends setTopicAttributes request', () => {

			const firstReq = nock('https://sns.eu-west-1.amazonaws.com:443')
				.post('/', 'Action=SetTopicAttributes&AttributeName=HTTPSuccessFeedbackRoleArn&AttributeValue=arn%3Aaws%3Aiam%3A%3Axxxx%3Arole%2FmyRole&TopicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A111111111111%3Amytopic&Version=2010-03-31')
				.reply(200);

			const secondReq = nock('https://sns.eu-west-1.amazonaws.com:443')
				.post('/', 'Action=SetTopicAttributes&AttributeName=HTTPSuccessFeedbackSampleRate&AttributeValue=100&TopicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A111111111111%3Amytopic&Version=2010-03-31')
				.reply(200);

			return sns
				.setTopicAttributes('arn:aws:sns:eu-west-1:111111111111:mytopic', {
					HTTPSuccessFeedbackRoleArn: 'arn:aws:iam::xxxx:role/myRole',
					HTTPSuccessFeedbackSampleRate: '100'
				})
				.then(() => {

					expect(firstReq.isDone()).to.be.true;
					expect(secondReq.isDone()).to.be.true;

				});

		});

	});

	describe('#setSubscriptionAttributes', () => {

		afterEach(() => nock.cleanAll());

		it('sends setSubscriptionAttributes request', () => {

			const firstReq = nock('https://sns.eu-west-1.amazonaws.com:443')
				.post('/', 'Action=SetSubscriptionAttributes&AttributeName=foo&AttributeValue=bar&SubscriptionArn=arn&Version=2010-03-31')
				.reply(200);

			const secondReq = nock('https://sns.eu-west-1.amazonaws.com:443')
				.post('/', 'Action=SetSubscriptionAttributes&AttributeName=bar&AttributeValue=foo&SubscriptionArn=arn&Version=2010-03-31')
				.reply(200);

			return sns
				.setSubscriptionAttributes('arn', {
					foo: 'bar',
					bar: 'foo'
				})
				.then(() => {

					expect(firstReq.isDone()).to.be.true;
					expect(secondReq.isDone()).to.be.true;

				});

		});

	});

	describe('#findSubscriptionArn', () => {

		afterEach(() => nock.cleanAll());

		it('rejects with error containing code NOT_FOUND if not found', (done) => {

			nock('https://sns.eu-west-1.amazonaws.com:443')
				.post('/', 'Action=ListSubscriptionsByTopic&TopicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A111111111111%3Amytopic&Version=2010-03-31')
				.reply(200, `
					<ListSubscriptionsByTopicResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
						<ListSubscriptionsByTopicResult>
							<Subscriptions>
								<member>
									<TopicArn>arn:aws:sns:us-east-1:123456789012:My-Topic</TopicArn>
									<Protocol>email</Protocol>
									<SubscriptionArn>arn:aws:sns:us-east-1:123456789012:My-Topic:80289ba6-0fd4-4079-afb4-ce8c8260f0ca</SubscriptionArn>
									<Owner>123456789012</Owner>
									<Endpoint>example@amazon.com</Endpoint>
								</member>
							</Subscriptions>
						</ListSubscriptionsByTopicResult>
					 </ListSubscriptionsByTopicResponse>
				`);

			sns
				.findSubscriptionArn('arn:aws:sns:eu-west-1:111111111111:mytopic', 'HTTP', 'http://foo.com/bar')
				.catch((err) => {

					expect(err.code).to.equal('NOT_FOUND');
					done();

				});

		});

		it('rejects with error containing code PENDING if subscription exists but is pending confirmation', (done) => {

			nock('https://sns.eu-west-1.amazonaws.com:443')
				.post('/', 'Action=ListSubscriptionsByTopic&TopicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A111111111111%3Amytopic&Version=2010-03-31')
				.reply(200, `
					<ListSubscriptionsByTopicResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
						<ListSubscriptionsByTopicResult>
							<Subscriptions>
								<member>
									<TopicArn>arn:aws:sns:us-east-1:123456789012:My-Topic</TopicArn>
									<Protocol>http</Protocol>
									<SubscriptionArn>PendingConfirmation</SubscriptionArn>
									<Owner>123456789012</Owner>
									<Endpoint>http://foo.com/bar</Endpoint>
								</member>
							</Subscriptions>
						</ListSubscriptionsByTopicResult>
					 </ListSubscriptionsByTopicResponse>
				`);

			sns
				.findSubscriptionArn('arn:aws:sns:eu-west-1:111111111111:mytopic', 'HTTP', 'http://foo.com/bar')
				.catch((err) => {

					expect(err.code).to.equal('PENDING');
					done();

				});
		});


		it('handles NextToken for paged results', () => {

			nock('https://sns.eu-west-1.amazonaws.com:443')
				.post('/', 'Action=ListSubscriptionsByTopic&TopicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A111111111111%3Amytopic&Version=2010-03-31')
				.reply(200, `
					<ListSubscriptionsByTopicResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
						<ListSubscriptionsByTopicResult>
							<Subscriptions>
								<member>
									<TopicArn>arn:aws:sns:us-east-1:123456789012:My-Topic</TopicArn>
									<Protocol>email</Protocol>
									<SubscriptionArn>arn:aws:sns:us-east-1:123456789012:My-Topic:80289ba6-0fd4-4079-afb4-ce8c8260f0ca</SubscriptionArn>
									<Owner>123456789012</Owner>
									<Endpoint>fo@foo.com</Endpoint>
								</member>
							</Subscriptions>
							<NextToken>foo</NextToken>
						</ListSubscriptionsByTopicResult>
					 </ListSubscriptionsByTopicResponse>
				`)
				.post('/', 'Action=ListSubscriptionsByTopic&NextToken=foo&TopicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A111111111111%3Amytopic&Version=2010-03-31')
				.reply(200, `
					<ListSubscriptionsByTopicResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
						<ListSubscriptionsByTopicResult>
							<Subscriptions>
								<member>
									<TopicArn>arn:aws:sns:us-east-1:123456789012:My-Topic</TopicArn>
									<Protocol>http</Protocol>
									<SubscriptionArn>arn:aws:sns:us-east-1:123456789012:My-Topic:80289ba6-0fd4-4079-afb4-ce8c8260f0ca</SubscriptionArn>
									<Owner>123456789012</Owner>
									<Endpoint>http://foo.com/bar</Endpoint>
								</member>
							</Subscriptions>
							<NextToken>foo</NextToken>
						</ListSubscriptionsByTopicResult>
					 </ListSubscriptionsByTopicResponse>
				`);

			return sns
				.findSubscriptionArn('arn:aws:sns:eu-west-1:111111111111:mytopic', 'HTTP', 'http://foo.com/bar')
				.then((arn) => {

					expect(arn).to.equal('arn:aws:sns:us-east-1:123456789012:My-Topic:80289ba6-0fd4-4079-afb4-ce8c8260f0ca');

				});

		});

		it('resolves with the subscription arn if found', () => {

			nock('https://sns.eu-west-1.amazonaws.com:443')
				.post('/', 'Action=ListSubscriptionsByTopic&TopicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A111111111111%3Amytopic&Version=2010-03-31')
				.reply(200, `
					<ListSubscriptionsByTopicResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
						<ListSubscriptionsByTopicResult>
							<Subscriptions>
								<member>
									<TopicArn>arn:aws:sns:us-east-1:123456789012:My-Topic</TopicArn>
									<Protocol>http</Protocol>
									<SubscriptionArn>arn:aws:sns:us-east-1:123456789012:My-Topic:80289ba6-0fd4-4079-afb4-ce8c8260f0ca</SubscriptionArn>
									<Owner>123456789012</Owner>
									<Endpoint>http://foo.com/bar</Endpoint>
								</member>
							</Subscriptions>
						</ListSubscriptionsByTopicResult>
					 </ListSubscriptionsByTopicResponse>
				`);

			return sns
				.findSubscriptionArn('arn:aws:sns:eu-west-1:111111111111:mytopic', 'HTTP', 'http://foo.com/bar')
				.then((arn) => {

					expect(arn).to.equal('arn:aws:sns:us-east-1:123456789012:My-Topic:80289ba6-0fd4-4079-afb4-ce8c8260f0ca');

				});

		});

	});
});
