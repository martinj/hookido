[![Build Status](https://travis-ci.org/martinj/hookido.svg?branch=master)](https://travis-ci.org/martinj/hookido)

# hookido

[Hapi](http://hapijs.com) plugin for handling [AWS SNS](https://aws.amazon.com/sns/) http(s) subscriptions aka webhooks

## Installation

This module is installed via npm:

	$ npm install hookido

## Options

- `skipPayloadValidation` - Skip Signature validation on SNS message, default `false`
- `aws` - AWS config passed to new AWS.SNS()
- `route`: Hapi route configuration overriding any defaults. Useful for setting `path` and `auth`.
- `topic` - Used for automatically setting attributes or subscribing on startup
    - `arn` - SNS topic arn **required**
    - `attributes` - Topic attributes, Object, key:value
    - `subscribe` - Automatically subscribe if subscription does not exit
    	- `endpoint` - **required**
    	- `protocol` - `HTTP` or `HTTPS` **required**
    	- `attributes` Object, key:value, Set subscription attributes, only used if the plugin handles the subscription confirmation and subscription does not exist'
- `handlers`
    - `subscriptionconfirmation` - `Function(req, h, payload)` If omitted the plugin will handle the subscription confirmation messages
	- `notification` - `Function(req, h, payload)` **required**


## Examples

If you already have subscription setup on SNS for your server

```javascript

	const Hapi = require('hapi');
	const server = new Hapi.Server();

	await server.register({
		plugin: require('hookido'),
		options: {
			aws: {
				region: 'eu-west-1',
				accessKeyId: 'a',
				secretAccessKey: 'a'
			},
			route: {
				path: '/path/used/in/subscription'
			},
			handlers: {
				notification: (req, h, payload) => {
					console.log('Got notification from SNS', payload);
					return 'Ok'
				}
			}
		}
	});

	await server.start();
	console.log('Server running and accepting SNS notifications');

```

Register subscription and set custom topic and subscription attributes on startup

```javascript

	const Hapi = require('hapi');
	const server = new Hapi.Server();

	await server.register({
		plugin: require('hookido'),
		options: {
			topic: {
				arn: 'arn:to:mytopic',
				attributes: {
					HTTPSuccessFeedbackRoleArn: 'arn:aws:iam::xxxx:role/myRole',
					HTTPSuccessFeedbackSampleRate: '100'
				},
				subscribe: {
					protocol: 'HTTP',
					endpoint: 'http://myserver.com/hookido',
					attributes: {
						DeliveryPolicy: '{"healthyRetryPolicy":{"numRetries":5}}'
					}
				}
			},
			aws: {
				region: 'eu-west-1',
				accessKeyId: 'a',
				secretAccessKey: 'a'
			},
			handlers: {
				notification: (req, h, payload) => {
					console.log('Got notification from SNS', payload);
					return 'Ok'
				}
			}
		}
	});

	await server.start();
	console.log('Server running and accepting SNS notifications');

```

Configuring multiple SNS topics

```javascript

	const Hapi = require('hapi');
	const server = new Hapi.Server();

	await server.register({
		plugin: require('hookido'),
		options: [{
			topic: {
				arn: 'arn:to:mytopic'
			},
			aws: {
				region: 'eu-west-1',
				accessKeyId: 'a',
				secretAccessKey: 'a'
			},
			route: {
				path: '/path/used/in/subscription'
			},
			handlers: {
				notification: (req, h, payload) => {
					console.log('Got notification from SNS', payload);
					return 'Ok';
				}
			}
		}, {
			topic: {
				arn: 'arn:to:mytopic2'
			},
			aws: {
				region: 'eu-central-1',
				accessKeyId: 'b',
				secretAccessKey: 'b'
			},
			route: {
				path: '/second/path'
			},
			handlers: {
				notification: (req, h, payload) => {
					console.log('Got notification from SNS', payload);
					return 'Ok';
				}
			}
		}]
	});

	await server.start;
	console.log('Server running and accepting SNS notifications');

```
