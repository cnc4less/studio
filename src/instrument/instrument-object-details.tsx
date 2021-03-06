import * as React from "react";
import { observer } from "mobx-react";
import { bind } from "bind-decorator";

import { Panels, Panel } from "shared/ui/panel";
import { Loader } from "shared/ui/loader";
import {
    PropertyList,
    StaticProperty,
    TextInputProperty,
    BooleanProperty
} from "shared/ui/properties";
import { AlertDanger } from "shared/ui/alert";

import { ConnectionProperties } from "instrument/window/connection-dialog";
import { InstrumentObject } from "instrument/instrument-object";

import { ConnectionParameters } from "instrument/connection/interface";

@observer
class Properties extends React.Component<
    {
        instrument: InstrumentObject;
    },
    {}
> {
    render() {
        const extension = this.props.instrument.extension;
        if (!extension) {
            return null;
        }

        return (
            <PropertyList>
                <StaticProperty name="Instrument" value={extension!.name} />
                <TextInputProperty
                    name="Label"
                    value={this.props.instrument.label || ""}
                    onChange={value => this.props.instrument.setLabel(value)}
                />
                <StaticProperty name="IDN" value={this.props.instrument.idn || "Not found!"} />
                <BooleanProperty
                    name="Auto connect"
                    value={this.props.instrument.autoConnect}
                    onChange={value => this.props.instrument.setAutoConnect(value)}
                />
            </PropertyList>
        );
    }
}

@observer
class Connection extends React.Component<{
    instrument: InstrumentObject;
}> {
    connectionParameters: ConnectionParameters | null;

    @bind
    dismissError() {
        this.props.instrument.connection.dismissError();
    }

    render() {
        let { instrument } = this.props;

        let connection = this.props.instrument.connection;

        let info;
        let error;
        let connectionParameters;
        let button;

        if (connection) {
            if (connection.isIdle) {
                error = connection.error && (
                    <AlertDanger onDismiss={this.dismissError}>{connection.error}</AlertDanger>
                );

                connectionParameters = (
                    <ConnectionProperties
                        connectionParameters={
                            (instrument.lastConnection as ConnectionParameters) ||
                            this.connectionParameters ||
                            instrument.defaultConnectionParameters
                        }
                        onConnectionParametersChanged={(
                            connectionParameters: ConnectionParameters
                        ) => {
                            this.connectionParameters = connectionParameters;
                        }}
                        availableConnections={this.props.instrument.availableConnections}
                        serialBaudRates={this.props.instrument.serialBaudRates}
                    />
                );

                button = (
                    <button
                        className="btn btn-success"
                        onClick={() => {
                            if (this.connectionParameters) {
                                this.props.instrument.setConnectionParameters(
                                    this.connectionParameters
                                );
                                this.connectionParameters = null;
                            } else if (!instrument.lastConnection) {
                                this.props.instrument.setConnectionParameters(
                                    instrument.defaultConnectionParameters
                                );
                            }
                            connection!.connect();
                        }}
                    >
                        Connect
                    </button>
                );
            } else {
                if (connection.isTransitionState) {
                    info = <Loader className="mb-2" />;
                }

                connectionParameters = instrument.connectionParametersDetails;

                if (connection.isConnected) {
                    button = (
                        <button className="btn btn-danger" onClick={() => connection!.disconnect()}>
                            Disconnect
                        </button>
                    );
                } else {
                    button = (
                        <button className="btn btn-danger" onClick={() => connection!.disconnect()}>
                            Abort
                        </button>
                    );
                }
            }
        }

        return (
            <div>
                <div>
                    {info}
                    {error}
                    {connectionParameters}
                    <div className="text-left">{button}</div>
                </div>
            </div>
        );
    }
}

export class InstrumentDetails extends React.Component<{ instrument: InstrumentObject }, {}> {
    @bind
    onOpen() {
        this.props.instrument.open();
    }

    render() {
        let { instrument } = this.props;
        return (
            <Panels>
                <Panel title="Actions">
                    <div className="text-center">
                        <button className="btn btn-primary" onClick={this.onOpen}>
                            Open
                        </button>
                    </div>
                </Panel>

                <Panel title="Properties">
                    <Properties instrument={instrument} />
                </Panel>

                <Panel title="Connection">
                    <Connection instrument={instrument} />
                </Panel>
            </Panels>
        );
    }
}
