import { observable, action, runInAction, values } from "mobx";

import { capitalize } from "shared/string";
import { IUnit, VOLTAGE_UNIT, CURRENT_UNIT, POWER_UNIT } from "shared/units";

import {
    ChartsController,
    IAxisModel,
    ZoomMode,
    IViewOptions,
    IViewOptionsAxesLines,
    IViewOptionsAxesLinesType,
    ChartMode
} from "shared/ui/chart";

import { AppStore } from "instrument/window/app-store";
import { undoManager } from "instrument/window/undo";

import { ChartsDisplayOption } from "instrument/window/lists/charts-view-options";

////////////////////////////////////////////////////////////////////////////////

const CONF_MAX_VOLTAGE = 40;
const CONF_MAX_CURRENT = 5;

function getFirstChannel(appStore: AppStore) {
    return appStore.instrument && appStore.instrument.firstChannel;
}

export function getMaxVoltage(appStore: AppStore): number {
    let maxVoltage;
    const channel = getFirstChannel(appStore);
    if (channel) {
        maxVoltage = channel.maxVoltage;
    }
    return maxVoltage || CONF_MAX_VOLTAGE;
}

export function getMaxCurrent(appStore: AppStore): number {
    let maxCurrent;
    const channel = getFirstChannel(appStore);
    if (channel) {
        maxCurrent = channel.maxCurrent;
    }
    return maxCurrent || CONF_MAX_CURRENT;
}

export function getMaxPower(appStore: AppStore): number {
    let maxPower;
    const channel = getFirstChannel(appStore);
    if (channel) {
        maxPower = channel.maxPower;
    }
    return maxPower || CONF_MAX_VOLTAGE * CONF_MAX_CURRENT;
}

export function getPowerLimitErrorMessage(appStore: AppStore) {
    return `Power limit of ${POWER_UNIT.formatValue(
        getMaxPower(appStore),
        Math.max(
            appStore.instrument!.getDigits(VOLTAGE_UNIT),
            appStore.instrument!.getDigits(CURRENT_UNIT)
        )
    )} exceeded`;
}

export function checkVoltage(voltage: number, appStore: AppStore) {
    const channel = getFirstChannel(appStore);
    if (channel) {
        const maxVoltage = channel.maxVoltage;
        if (maxVoltage !== undefined) {
            if (voltage > maxVoltage) {
                return false;
            }
        }
    }
    return true;
}

export function checkCurrent(current: number, appStore: AppStore) {
    const channel = getFirstChannel(appStore);
    if (channel) {
        const maxCurrent = channel.maxCurrent;
        if (maxCurrent !== undefined) {
            if (current > maxCurrent) {
                return false;
            }
        }
    }
    return true;
}

export function checkPower(power: number, appStore: AppStore) {
    const channel = getFirstChannel(appStore);
    if (channel) {
        const maxPower = channel.maxPower;
        if (maxPower !== undefined) {
            if (power > maxPower) {
                return false;
            }
        }
    }
    return true;
}

////////////////////////////////////////////////////////////////////////////////

class ListViewOptions implements IViewOptions {
    @observable
    axesLines: IViewOptionsAxesLines = {
        type: "dynamic",
        steps: {
            x: [0.01, 0.1, 1, 10],
            y: [[0.1, 1, 10], [0.01, 0.1, 1]]
        },
        majorSubdivision: {
            horizontal: 24,
            vertical: 8
        },
        minorSubdivision: {
            horizontal: 5,
            vertical: 5
        },
        snapToGrid: true
    };

    @observable showAxisLabels: boolean = true;

    @observable showZoomButtons: boolean = true;

    constructor(private list: BaseList, props: any) {
        if (props) {
            this.axesLines = props.axesLines;
            this.showAxisLabels = props.showAxisLabels;
            this.showZoomButtons = props.showZoomButtons;
        }
    }

    applyChanges(changes: any) {
        if ("axesLines" in changes) {
            this.axesLines = changes.axesLines;
        }

        if ("showAxisLabels" in changes) {
            this.showAxisLabels = changes.showAxisLabels;
        }

        if ("showZoomButtons" in changes) {
            this.showZoomButtons = changes.showZoomButtons;
        }
    }

    setAxesLinesType(newType: IViewOptionsAxesLinesType) {
        const oldType = this.axesLines.type;
        undoManager.addCommand(
            `Edit ${this.list.type} list`,
            this.list.appStore.instrumentListStore,
            this.list,
            {
                execute: action(() => {
                    this.axesLines.type = newType;
                }),
                undo: action(() => {
                    this.axesLines.type = oldType;
                })
            }
        );
    }

    setAxesLinesMajorSubdivisionHorizontal(newValue: number) {
        const oldValue = this.axesLines.majorSubdivision.horizontal;
        undoManager.addCommand(
            `Edit ${this.list.type} list`,
            this.list.appStore.instrumentListStore,
            this.list,
            {
                execute: action(() => {
                    this.axesLines.majorSubdivision.horizontal = newValue;
                }),
                undo: action(() => {
                    this.axesLines.majorSubdivision.horizontal = oldValue;
                })
            }
        );
    }

    setAxesLinesMajorSubdivisionVertical(newValue: number) {
        const oldValue = this.axesLines.majorSubdivision.vertical;
        undoManager.addCommand(
            `Edit ${this.list.type} list`,
            this.list.appStore.instrumentListStore,
            this.list,
            {
                execute: action(() => {
                    this.axesLines.majorSubdivision.vertical = newValue;
                }),
                undo: action(() => {
                    this.axesLines.majorSubdivision.vertical = oldValue;
                })
            }
        );
    }

    setAxesLinesMinorSubdivisionHorizontal(newValue: number) {
        const oldValue = this.axesLines.minorSubdivision.horizontal;
        undoManager.addCommand(
            `Edit ${this.list.type} list`,
            this.list.appStore.instrumentListStore,
            this.list,
            {
                execute: action(() => {
                    this.axesLines.minorSubdivision.horizontal = newValue;
                }),
                undo: action(() => {
                    this.axesLines.minorSubdivision.horizontal = oldValue;
                })
            }
        );
    }

    setAxesLinesMinorSubdivisionVertical(newValue: number) {
        const oldValue = this.axesLines.minorSubdivision.vertical;
        undoManager.addCommand(
            `Edit ${this.list.type} list`,
            this.list.appStore.instrumentListStore,
            this.list,
            {
                execute: action(() => {
                    this.axesLines.minorSubdivision.vertical = newValue;
                }),
                undo: action(() => {
                    this.axesLines.minorSubdivision.vertical = oldValue;
                })
            }
        );
    }

    setAxesLinesStepsX(newValue: number[]) {
        const oldValue = this.axesLines.steps.x;
        undoManager.addCommand(
            `Edit ${this.list.type} list`,
            this.list.appStore.instrumentListStore,
            this.list,
            {
                execute: action(() => {
                    this.axesLines.steps.x = newValue;
                }),
                undo: action(() => {
                    this.axesLines.steps.x = oldValue;
                })
            }
        );
    }

    setAxesLinesStepsY(index: number, newValue: number[]): void {
        const oldValue = this.axesLines.steps.y[index];
        undoManager.addCommand(
            `Edit ${this.list.type} list`,
            this.list.appStore.instrumentListStore,
            this.list,
            {
                execute: action(() => {
                    this.axesLines.steps.y[index] = newValue;
                }),
                undo: action(() => {
                    this.axesLines.steps.y[index] = oldValue;
                })
            }
        );
    }

    setAxesLinesSnapToGrid(newValue: boolean): void {
        const oldValue = this.axesLines.snapToGrid;
        undoManager.addCommand(
            `Edit ${this.list.type} list`,
            this.list.appStore.instrumentListStore,
            this.list,
            {
                execute: action(() => {
                    this.axesLines.snapToGrid = newValue;
                }),
                undo: action(() => {
                    this.axesLines.snapToGrid = oldValue;
                })
            }
        );
    }

    setShowAxisLabels(newValue: boolean) {
        const oldValue = this.showAxisLabels;
        undoManager.addCommand(
            `Edit ${this.list.type} list`,
            this.list.appStore.instrumentListStore,
            this.list,
            {
                execute: action(() => {
                    this.showAxisLabels = newValue;
                }),
                undo: action(() => {
                    this.showAxisLabels = oldValue;
                })
            }
        );
    }

    setShowZoomButtons(newValue: boolean) {
        const oldValue = this.showZoomButtons;
        undoManager.addCommand(
            `Edit ${this.list.type} list`,
            this.list.appStore.instrumentListStore,
            this.list,
            {
                execute: action(() => {
                    this.showZoomButtons = newValue;
                }),
                undo: action(() => {
                    this.showZoomButtons = oldValue;
                })
            }
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

export class ListAxisModel implements IAxisModel {
    // @todo Currently, this will be saved in database (because toJS enumerates this property also).
    //       Find a way no to save.
    unit: IUnit;

    constructor(public list: BaseList, unit: IUnit) {
        this.unit = unit.clone();
        this.unit.precision = list.appStore.instrument!.getDigits(unit);

        const props = list.props.data[this.unit.name + "AxisModel"];

        this.dynamic = (props && props.dynamic) || {
            zoomMode: "default",
            from: 0,
            to: 0
        };

        this.fixed = (props && props.fixed) || {
            zoomMode: "default",
            subdivisionOffset: 0,
            subdivisonScale: 0
        };
    }

    applyChanges(changes: any) {
        if ("dynamic" in changes) {
            this.dynamic = changes.dynamic;
        }

        if ("fixed" in changes) {
            this.fixed = changes.fixed;
        }
    }

    get minValue(): number {
        return 0;
    }

    get maxValue(): number {
        return this.unit.name === "voltage"
            ? getMaxVoltage(this.list.appStore)
            : getMaxCurrent(this.list.appStore);
    }

    get defaultFrom() {
        return this.minValue;
    }

    get defaultTo() {
        return this.maxValue;
    }

    @observable
    dynamic: {
        zoomMode: ZoomMode;
        from: number;
        to: number;
    };

    @observable
    fixed: {
        zoomMode: ZoomMode;
        subdivisionOffset: number;
        subdivisonScale: number;
    };

    get defaultSubdivisionOffset() {
        return undefined;
    }

    get defaultSubdivisionScale() {
        return undefined;
    }

    get label() {
        return capitalize(this.unit.name);
    }

    get color() {
        return this.unit.color;
    }

    get colorInverse() {
        return this.unit.colorInverse;
    }
}

////////////////////////////////////////////////////////////////////////////////

export type IListType = "table" | "envelope";

export interface ITableListData {
    dwell: number[];
    voltage: number[];
    current: number[];
}

export class BaseListData {
    @observable viewOptions: ListViewOptions;

    @observable timeAxisModel: ListAxisModel;
    @observable voltageAxisModel: ListAxisModel;
    @observable currentAxisModel: ListAxisModel;

    constructor(list: BaseList, props: any) {
        this.viewOptions = new ListViewOptions(list, props.viewOptions);

        this.voltageAxisModel = new ListAxisModel(list, VOLTAGE_UNIT);
        this.currentAxisModel = new ListAxisModel(list, CURRENT_UNIT);
    }

    applyChanges(changes: any) {
        if ("viewOptions" in changes) {
            this.viewOptions.applyChanges(changes.viewOptions);
        }

        if ("timeAxisModel" in changes) {
            this.timeAxisModel.applyChanges(changes.timeAxisModel);
        }

        if ("voltageAxisModel" in changes) {
            this.voltageAxisModel.applyChanges(changes.voltageAxisModel);
        }

        if ("currentAxisModel" in changes) {
            this.currentAxisModel.applyChanges(changes.currentAxisModel);
        }
    }
}

export abstract class BaseList {
    id: string;
    @observable name: string;
    @observable description: string;

    type: string;
    abstract data: BaseListData;

    constructor(public props: any, public appStore: AppStore) {
        this.id = props.id;
        this.name = props.name;
        this.description = props.description;
    }

    applyChanges(changes: any) {
        if ("name" in changes) {
            this.name = changes.name;
        }

        if ("description" in changes) {
            this.description = changes.description;
        }

        if ("data" in changes) {
            this.data.applyChanges(changes.data);
        }
    }

    abstract getMaxTime(): number;

    abstract createChartsController(
        displayOption: ChartsDisplayOption,
        mode: ChartMode
    ): ChartsController;

    abstract renderDetailsView(): JSX.Element;

    abstract get tableListData(): ITableListData;
}

////////////////////////////////////////////////////////////////////////////////

export function createInstrumentLists(appStore: AppStore) {
    const instrumentLists = observable.map<string, BaseList>();

    appStore.instrumentListStore.watch({
        createObject(object: any) {
            runInAction(() => instrumentLists.set(object.id, object));
        },

        updateObject(changes: any) {
            const list = instrumentLists.get(changes.id);
            if (list) {
                runInAction(() => {
                    list.applyChanges(changes);
                });
            }
        },

        deleteObject(object: any) {
            runInAction(() => {
                instrumentLists.delete(object.id);
            });
        }
    });

    return instrumentLists;
}

export function findListIdByName(listName: string, appStore: AppStore) {
    if (!appStore.instrumentLists) {
        return undefined;
    }
    const list = values(appStore.instrumentLists).find(list => list.name === listName);
    if (list) {
        return list.id;
    }
    return undefined;
}
