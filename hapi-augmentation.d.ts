import '@hapi/hapi';
import SNS from './lib/sns'; // Assuming SNS is exported from here

declare module '@hapi/hapi' {
    interface PluginProperties {
        hookido?: {
            snsInstances: SNS[];
        };
        // If other plugins also add to server.plugins,
        // you can declare them here as well.
    }
}
