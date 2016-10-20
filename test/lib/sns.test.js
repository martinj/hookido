'use strict';

const nock = require('nock');
const expect = require('chai').expect;
const SNS = require('../../lib/sns');

describe('SNS', () => {
	let sns;

	beforeEach(() => {
		sns = new SNS('arn:aws:sns:eu-west-1:111111111111:mytopic', {region: 'eu-west-1'});
	});

	describe('#validatePayload', () => {

		it('rejects on invalid JSON', () => {

			return sns
				.validatePayload('ada')
				.catch((err) => {
					expect(err.message).to.equal('Invalid SNS payload: Unexpected token a in JSON at position 0');
					return sns.validatePayload(null);
				})
				.catch((err) => {
					expect(err.message).to.equal('Invalid SNS payload: Not valid JSON');
				});

		});

		it('rejects on invalid payload', () => {

			return sns
				.validatePayload('{"foo":"bar"}')
				.catch((err) => {
					expect(err.message).to.equal('Message missing required keys.');
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
				.subscribe('HTTP', 'http://foobar.com')
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
				.setTopicAttributes({
					HTTPSuccessFeedbackRoleArn: 'arn:aws:iam::xxxx:role/myRole',
					HTTPSuccessFeedbackSampleRate: '100'
				})
				.then(() => {

					expect(firstReq.isDone()).to.be.true;
					expect(secondReq.isDone()).to.be.true;

				});

		});

	});

});
