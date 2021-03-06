import {
    observable,
    extendObservable,
    computed,
    action,
    isObservableArray,
    toJS,
    reaction,
    autorun
} from "mobx";

import { confirmSave } from "shared/util";
import { humanize } from "shared/string";
import { _each, _isArray, _map, _uniqWith } from "shared/algorithm";

import { showGenericDialog, TableField } from "shared/ui/generic-dialog";

import {
    EezObject,
    MetaData,
    PropertyMetaData,
    findMetaData,
    EezValueObject
} from "project-editor/core/metaData";
import { TreeObjectAdapter } from "project-editor/core/objectAdapter";
import { findAllReferences, isReferenced } from "project-editor/core/search";
import { OutputSections, OutputSection } from "project-editor/core/output";
import { confirm } from "project-editor/core/util";

import {
    ProjectProperties,
    save as saveProject,
    load as loadProject,
    getNewProject
} from "project-editor/project/project";
import { build as buildProject, backgroundCheck } from "project-editor/project/build";
import { getAllMetrics } from "project-editor/project/metrics";

const { Menu, MenuItem } = EEZStudio.electron.remote;
const path = EEZStudio.electron.remote.require("path");
const ipcRenderer = EEZStudio.electron.ipcRenderer;
const fs = EEZStudio.electron.remote.require("fs");

////////////////////////////////////////////////////////////////////////////////

interface Panel {
    selectedObject: EezObject | undefined;
}

type NavigationItem = EezObject | TreeObjectAdapter;

class NavigationStoreClass {
    @observable navigationMap = new Map<string, NavigationItem>();
    @observable selectedPanel: Panel | undefined;

    load(map: { [stringPath: string]: string }) {
        let navigationMap = new Map<string, NavigationItem>();

        for (let stringPath in map) {
            let navigationObject = getObjectFromStringPath(stringPath);
            if (navigationObject) {
                let navigationItemStr = map[stringPath];
                if (navigationItemStr === stringPath) {
                    continue;
                }
                let navigationItem: NavigationItem | undefined;
                if (typeof navigationItemStr == "string") {
                    navigationItem = getObjectFromStringPath(navigationItemStr);
                } else {
                    let navigationObjectAdapter = new TreeObjectAdapter(navigationObject);
                    setTimeout(() => {
                        navigationObjectAdapter.loadState(navigationItemStr);
                    }, 0);
                    navigationItem = navigationObjectAdapter;
                }

                if (navigationItem) {
                    navigationMap.set(navigationObject.$eez.id, navigationItem);
                }
            }
        }

        this.navigationMap = navigationMap;
    }

    @computed
    get toJS() {
        let map: any = {};
        for (var [id, navigationItem] of this.navigationMap) {
            let navigationObject = getObjectFromObjectId(id);
            if (navigationObject) {
                let navigationObjectPath = getObjectPathAsString(navigationObject);
                if (navigationItem instanceof TreeObjectAdapter) {
                    map[navigationObjectPath] = navigationItem.saveState();
                } else {
                    map[navigationObjectPath] = getObjectPathAsString(navigationItem);
                }
            }
        }
        return map;
    }

    @action
    setSelectedPanel(selectedPanel: Panel | undefined) {
        this.selectedPanel = selectedPanel;
    }

    @computed
    get selectedObject(): EezObject | undefined {
        let object: EezObject = ProjectStore.projectProperties;
        if (!object) {
            return undefined;
        }

        while (true) {
            let child = this.getNavigationSelectedItem(object);
            if (!child) {
                return object;
            }
            if (child instanceof TreeObjectAdapter) {
                return child.selectedObject;
            }
            object = child;
        }
    }

    getSelection(): EezObject[] | undefined {
        // TODO
        return undefined;
    }

    @action
    setSelection(selection: EezObject[] | undefined) {
        if (!selection || selection.length == 0) {
            return;
        }

        let object = selection[0];

        let iterObject = object;
        let parent = iterObject.getParent();
        while (iterObject && parent) {
            if (parent.$eez.metaData.navigationComponent) {
                let grandparent = parent.getParent();
                if (!isArray(grandparent)) {
                    let navigationItem = this.getNavigationSelectedItem(parent);
                    if (navigationItem && navigationItem instanceof TreeObjectAdapter) {
                        navigationItem.selectObject(object);
                    } else {
                        this.setNavigationSelectedItem(parent, iterObject);
                    }
                }
            }
            iterObject = parent;
            parent = iterObject.getParent();
        }
    }

    isSelected(object: EezObject) {
        let iterObject = object;
        let parent = iterObject.getParent();
        while (iterObject && parent) {
            if (parent.$eez.metaData.navigationComponent) {
                let grandparent = parent.getParent();
                if (!isArray(grandparent)) {
                    let navigationItem = this.getNavigationSelectedItem(parent);
                    if (navigationItem && navigationItem instanceof TreeObjectAdapter) {
                        if (navigationItem.selectedObject != object) {
                            return false;
                        }
                    } else {
                        if (navigationItem != iterObject) {
                            return false;
                        }
                    }
                }
            }
            iterObject = parent;
            parent = iterObject.getParent();
        }

        return true;
    }

    getNavigationSelectedItem(navigationObject: EezObject): NavigationItem | undefined {
        let item = this.navigationMap.get(navigationObject.$eez.id);

        if (item && !(item instanceof TreeObjectAdapter)) {
            // is this maybe deleted object?
            item = getObjectFromObjectId(item.$eez.id);
        }

        if (!item) {
            let defaultNavigationKey = navigationObject.$eez.metaData.defaultNavigationKey;
            if (defaultNavigationKey) {
                item = navigationObject[defaultNavigationKey];
            }
        }
        return item;
    }

    getNavigationSelectedItemAsObject(navigationObject: EezObject): EezObject | undefined {
        let navigationItem = this.getNavigationSelectedItem(navigationObject);
        if (navigationItem instanceof TreeObjectAdapter) {
            console.error("TreeObjectAdapter is not expected");
            return undefined;
        }
        return navigationItem;
    }

    getNavigationSelectedItemAsObjectAdapter(
        navigationObject: EezObject
    ): TreeObjectAdapter | undefined {
        let navigationItem = this.getNavigationSelectedItem(navigationObject);
        if (navigationItem && !(navigationItem instanceof TreeObjectAdapter)) {
            console.error("TreeObjectAdapter is expected");
            return undefined;
        }
        return navigationItem;
    }

    @action
    setNavigationSelectedItem(navigationObject: EezObject, navigationItem: NavigationItem) {
        this.navigationMap.set(navigationObject.$eez.id, navigationItem);
        let parent = navigationObject.getParent();
        if (parent) {
            if (!this.getNavigationSelectedItem(parent)) {
                this.setNavigationSelectedItem(parent, navigationObject);
            }
        }
    }

    showObject(objectToShow: EezObject) {
        this.setSelection([objectToShow]);
        for (
            let object: EezObject | undefined = objectToShow;
            object;
            object = object.getParent()
        ) {
            if (object.$eez.metaData.editorComponent) {
                const editor = EditorsStore.openEditor(object);
                setTimeout(() => {
                    if (editor && editor.state) {
                        editor.state.selectObject(
                            isValue(objectToShow)
                                ? (objectToShow.getParent() as EezObject)
                                : objectToShow
                        );
                    }
                }, 0);
                break;
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

export interface EditorState {
    loadState(state: any): void;
    saveState(): any;
    selectObject(object: EezObject): void;
}

export class Editor {
    @observable object: EezObject;
    @observable active: boolean;
    @observable permanent: boolean;
    @observable state: EditorState | undefined;

    @computed
    get id() {
        return this.object.$eez.id;
    }

    @computed
    get title() {
        if (isArrayElement(this.object)) {
            return `${this.object.$eez.metaData.className}: ${objectToString(this.object)}`;
        } else {
            return objectToString(this.object);
        }
    }

    @action
    makeActive() {
        EditorsStore.activateEditor(this);
    }

    @action
    makePermanent() {
        this.permanent = true;
    }

    close() {
        EditorsStore.closeEditor(this);
    }
}

class EditorsStoreClass {
    @observable editors: Editor[] = [];

    constructor() {
        // open editor when navigation selection has changed
        autorun(() => {
            let object = NavigationStore.selectedObject;
            while (object) {
                let navigationItem = NavigationStore.getNavigationSelectedItem(object);
                while (navigationItem) {
                    if (navigationItem instanceof TreeObjectAdapter) {
                        let object = navigationItem.selectedObject;
                        if (object && !isArray(object) && object.$eez.metaData.editorComponent) {
                            this.openEditor(object);
                        } else if (navigationItem.object.$eez.metaData.editorComponent) {
                            this.openEditor(navigationItem.object);
                        }
                        return;
                    } else {
                        if (
                            !isArray(navigationItem) &&
                            navigationItem.$eez.metaData.editorComponent
                        ) {
                            this.openEditor(navigationItem);
                        }
                        navigationItem = NavigationStore.getNavigationSelectedItem(navigationItem);
                    }
                }

                object = object.getParent();
            }
        });

        // close non-permanent editor if editor object is not selected
        // autorun(() => {
        //     for (let i = 0; i < this.editors.length; ++i) {
        //         if (!this.editors[i].permanent) {
        //             if (!NavigationStore.isSelected(this.editors[i].object)) {
        //                 this.closeEditor(this.editors[i]);
        //             }
        //             break;
        //         }
        //     }
        // });

        // close editor if editor object doesn't exists anymore
        autorun(() => {
            this.editors.slice().forEach(editor => {
                let parent = editor.object.$eez.parent;
                if (parent && isArray(parent) && asArray(parent).indexOf(editor.object) == -1) {
                    this.closeEditor(editor);
                }
            });
        });
    }

    load(editors: any[]) {
        if (editors) {
            this.editors = editors
                .map((editor: any) => {
                    let object;
                    if (_isArray(editor.object)) {
                        object = getObjectFromPath(editor.object);
                    } else {
                        object = getObjectFromStringPath(editor.object);
                    }
                    if (object) {
                        let newEditor = new Editor();
                        newEditor.object = object;
                        newEditor.active = editor.active;
                        newEditor.permanent = editor.permanent;
                        if (object.$eez.metaData.createEditorState) {
                            newEditor.state = object.$eez.metaData.createEditorState(object);
                            if (editor.state) {
                                newEditor.state.loadState(editor.state);
                            }
                        }
                        return newEditor;
                    }
                    return undefined;
                })
                .filter((editor: Editor | undefined) => !!editor) as Editor[];
        } else {
            this.editors = [];
        }
    }

    @computed
    get toJS() {
        return this.editors.map(editor => ({
            object: getObjectPathAsString(editor.object),
            active: editor.active,
            permanent: editor.permanent,
            state: editor.state && editor.state.saveState()
        }));
    }

    @computed
    get activeEditor() {
        for (let i = 0; i < this.editors.length; ++i) {
            let editor = this.editors[i];
            if (editor.active) {
                return editor;
            }
        }
        return undefined;
    }

    @action
    activateEditor(editor: Editor) {
        if (editor.active) {
            return;
        }

        let activeEditor = this.activeEditor;
        if (activeEditor) {
            activeEditor.active = false;
        }

        editor.active = true;
    }

    @action
    openEditor(object: EezObject, openAsPermanentEditor: boolean = false) {
        let nonPermanentEditor: Editor | undefined;

        let editorFound: Editor | undefined;

        for (let i = 0; i < this.editors.length; ++i) {
            if (this.editors[i].object == object) {
                this.editors[i].active = true;
                editorFound = this.editors[i];
            } else {
                if (this.editors[i].active) {
                    this.editors[i].active = false;
                }
                if (!openAsPermanentEditor && !this.editors[i].permanent) {
                    nonPermanentEditor = this.editors[i];
                }
            }
        }

        if (editorFound) {
            return editorFound;
        }

        if (!nonPermanentEditor) {
            nonPermanentEditor = new Editor();
            this.editors.push(nonPermanentEditor);
        }
        nonPermanentEditor.permanent = openAsPermanentEditor;
        nonPermanentEditor.object = object;
        nonPermanentEditor.active = true;
        if (object.$eez.metaData.createEditorState) {
            nonPermanentEditor.state = object.$eez.metaData.createEditorState(object);
        } else {
            nonPermanentEditor.state = undefined;
        }

        return nonPermanentEditor;
    }

    @action
    openPermanentEditor(object: EezObject) {
        this.openEditor(object, true);
    }

    @action
    makeActiveEditorPermanent() {
        for (let i = 0; i < this.editors.length; ++i) {
            if (this.editors[i].active) {
                this.editors[i].permanent = true;
                return;
            }
        }
    }

    @action
    closeEditor(editor: Editor) {
        let index = this.editors.indexOf(editor);
        if (index != -1) {
            this.editors.splice(index, 1);
            if (editor.active) {
                if (index < this.editors.length) {
                    this.activateEditor(this.editors[index]);
                } else if (this.editors.length > 0) {
                    this.activateEditor(this.editors[this.editors.length - 1]);
                }
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

export class ViewOptions {
    @observable navigationVisible: boolean = true;
    @observable outputVisible: boolean = true;
    @observable propertiesVisible: boolean = true;
    @observable debugVisible: boolean = false;

    @action
    load(viewOptions: any) {
        if (viewOptions) {
            this.navigationVisible = viewOptions.navigationVisible;
            this.outputVisible = viewOptions.outputVisible;
            this.propertiesVisible = viewOptions.propertiesVisible;
            this.debugVisible = viewOptions.debugVisible;
        } else {
            this.navigationVisible = true;
            this.outputVisible = true;
            this.propertiesVisible = true;
            this.debugVisible = false;
        }
    }

    @computed
    get toJS() {
        return toJS(this);
    }
}

////////////////////////////////////////////////////////////////////////////////

class UIStateStoreClass {
    @observable viewOptions: ViewOptions = new ViewOptions();
    @observable selectedBuildConfiguration: string;
    @observable splitters = new Map<string, number>();
    @observable features: any;

    @observable savedState: any;

    constructor() {
        autorun(() => {
            this.savedState = this.toJS;
        });

        // react when selected panel or selected message in output window has changed
        reaction(
            () => ({
                message: OutputSectionsStore.activeSection.selectedMessage,
                panel: NavigationStore.selectedPanel
            }),
            arg => {
                if (arg.panel instanceof OutputSection && arg.message && arg.message.object) {
                    NavigationStore.showObject(arg.message.object);
                }
            }
        );
    }

    loadSplitters(splitters: any) {
        this.splitters.clear();
        _each(splitters, (value: any, name: any) => {
            this.splitters.set(name as string, value);
        });
    }

    @action
    load(uiState: any) {
        this.viewOptions.load(uiState.viewOptions);
        NavigationStore.load(uiState.navigationMap);
        EditorsStore.load(uiState.editors);
        this.selectedBuildConfiguration = uiState.selectedBuildConfiguration || "Default";
        this.loadSplitters(uiState.splitters);
        this.features = observable(uiState.features || {});
    }

    @computed
    get splittersJS() {
        let map: any = {};
        for (var [name, value] of this.splitters) {
            map[name] = value;
        }
        return map;
    }

    @computed
    get featuresJS() {
        return toJS(this.features);
    }

    @computed
    get toJS() {
        return {
            viewOptions: this.viewOptions.toJS,
            navigationMap: NavigationStore.toJS,
            editors: EditorsStore.toJS,
            selectedBuildConfiguration: this.selectedBuildConfiguration,
            splitters: this.splittersJS,
            features: this.featuresJS
        };
    }

    @computed
    get isModified() {
        return !!this.savedState;
    }

    @action
    save(): string {
        let result = JSON.stringify(this.savedState, null, 2);
        this.savedState = undefined;
        return result;
    }

    @action
    getFeatureParam<T>(extensionName: string, paramName: string, defaultValue: T): T {
        let extension = this.features[extensionName];
        if (!extension) {
            extension = observable({});
            extendObservable(this.features, {
                [extensionName]: extension
            });
        }
        let paramValue = extension[paramName];
        if (!paramValue) {
            extendObservable(extension, {
                [paramName]: defaultValue
            });
            return defaultValue;
        }
        return paramValue as T;
    }

    @action
    setSelectedBuildConfiguration(selectedBuildConfiguration: string) {
        this.selectedBuildConfiguration = selectedBuildConfiguration;
    }
}

////////////////////////////////////////////////////////////////////////////////

interface Command {
    execute(): void;
    undo(): void;
    description: string;
}

interface UndoItem {
    commands: Command[];
    selectionBefore: any;
    selectionAfter: any;
}

export class UndoManagerClass {
    @observable undoStack: UndoItem[] = [];
    @observable redoStack: UndoItem[] = [];
    @observable commands: Command[] = [];

    private selectionBeforeFirstCommand: any;
    public combineCommands: boolean = false;

    @action
    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }

    @action
    pushToUndoStack() {
        if (this.commands.length > 0) {
            let selectionAfter = NavigationStore.getSelection();
            this.undoStack.push({
                commands: this.commands,
                selectionBefore: this.selectionBeforeFirstCommand,
                selectionAfter: selectionAfter
            });

            this.commands = [];
            this.selectionBeforeFirstCommand = NavigationStore.getSelection();
        }
    }

    @action
    setCombineCommands(value: boolean) {
        this.pushToUndoStack();
        this.combineCommands = value;
    }

    @action
    executeCommand(command: Command) {
        if (this.commands.length == 0) {
            this.selectionBeforeFirstCommand = NavigationStore.getSelection();
        } else {
            if (!this.combineCommands) {
                this.pushToUndoStack();
            }
        }

        command.execute();
        this.commands.push(command);

        this.redoStack = [];

        ProjectStore.setModified(true);
    }

    static getCommandsDescription(commands: Command[]) {
        return commands[commands.length - 1].description;
    }

    @computed
    get canUndo() {
        return this.undoStack.length > 0 || this.commands.length > 0;
    }

    @computed
    get undoDescription() {
        let commands;
        if (this.commands.length > 0) {
            commands = this.commands;
        } else if (this.undoStack.length > 0) {
            commands = this.undoStack[this.undoStack.length - 1].commands;
        }
        if (commands) {
            return UndoManagerClass.getCommandsDescription(commands);
        }
        return undefined;
    }

    @action
    undo() {
        this.pushToUndoStack();

        let undoItem = this.undoStack.pop();
        if (undoItem) {
            for (let i = undoItem.commands.length - 1; i >= 0; --i) {
                undoItem.commands[i].undo();
            }

            NavigationStore.setSelection(undoItem.selectionBefore);

            this.redoStack.push(undoItem);
        }
    }

    @computed
    get canRedo() {
        return this.redoStack.length > 0;
    }

    @computed
    get redoDescription() {
        let commands;
        if (this.redoStack.length > 0) {
            commands = this.redoStack[this.redoStack.length - 1].commands;
        }
        if (commands) {
            return UndoManagerClass.getCommandsDescription(commands);
        }
        return undefined;
    }

    @action
    redo() {
        let redoItem = this.redoStack.pop();
        if (redoItem) {
            for (let i = 0; i < redoItem.commands.length; ++i) {
                redoItem.commands[i].execute();
            }

            NavigationStore.setSelection(redoItem.selectionAfter);

            this.undoStack.push(redoItem);
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

function getUIStateFilePath(projectFilePath: string) {
    return projectFilePath + "-ui-state";
}

class ProjectStoreClass {
    @observable properties: ProjectProperties | undefined;
    @observable filePath: string | undefined;
    @observable modified: boolean = false;

    constructor() {
        autorun(() => {
            this.updateProjectWindowState();
        });

        // check the project in the background
        autorun(() => {
            if (this.properties) {
                backgroundCheck();
            }
        });
    }

    updateProjectWindowState() {
        let title = "";

        if (this.properties) {
            if (this.modified) {
                title += "\u25CF ";
            }

            if (this.filePath) {
                title += path.basename(this.filePath) + " - ";
            } else {
                title += "untitled - ";
            }
        }

        title += EEZStudio.title;

        if (title != document.title) {
            document.title = title;
        }

        EEZStudio.electron.ipcRenderer.send("windowSetState", {
            modified: this.modified,
            projectFilePath: this.filePath,
            undo: (UndoManager && UndoManager.canUndo && UndoManager.undoDescription) || null,
            redo: (UndoManager && UndoManager.canRedo && UndoManager.redoDescription) || null
        });
    }

    @computed
    get isOpen() {
        return this.properties != undefined;
    }

    @computed
    get projectProperties(): ProjectProperties {
        return this.properties as ProjectProperties;
    }

    @computed
    get selectedBuildConfiguration() {
        let configuration =
            this.projectProperties &&
            this.projectProperties.settings.build.configurations.find(
                configuration => configuration.name == UIStateStore.selectedBuildConfiguration
            );
        return configuration;
    }

    @computed
    get selectedScreenOrientation() {
        let configuration =
            this.projectProperties &&
            this.projectProperties.settings.build.configurations.find(
                configuration => configuration.name == UIStateStore.selectedBuildConfiguration
            );
        return (configuration && configuration.screenOrientation) || "portrait";
    }

    @computed
    get isModified() {
        return this.modified;
    }

    getFilePathRelativeToProjectPath(absoluteFilePath: string) {
        return path.relative(path.dirname(this.filePath), absoluteFilePath);
    }

    getAbsoluteFilePath(relativeFilePath: string) {
        return this.filePath
            ? path.resolve(
                  path.dirname(this.filePath),
                  relativeFilePath.replace(/(\\|\/)/g, path.sep)
              )
            : relativeFilePath;
    }

    getFolderPathRelativeToProjectPath(absoluteFolderPath: string) {
        let folder = path.relative(path.dirname(this.filePath), absoluteFolderPath);
        if (folder == "") {
            folder = ".";
        }
        return folder;
    }

    @action
    setModified(modified_: boolean) {
        this.modified = modified_;
    }

    updateMruFilePath() {
        ipcRenderer.send("setMruFilePath", this.filePath);
    }

    changeProject(
        projectFilePath: string | undefined,
        project?: ProjectProperties,
        uiState?: ProjectProperties
    ) {
        if (project) {
            project.callExtendObservableForAllOptionalProjectFeatures();
        }

        action(() => {
            this.filePath = projectFilePath;
            this.properties = project;
        })();

        UIStateStore.load(uiState || {});

        if (this.filePath) {
            this.updateMruFilePath();
        }

        UndoManager.clear();
    }

    doSave(callback: (() => void) | undefined) {
        if (this.filePath) {
            saveProject(this.filePath)
                .then(() => {
                    this.setModified(false);

                    if (callback) {
                        callback();
                    }
                })
                .catch(error => console.error("Save", error));
        }
    }

    @action
    savedAsFilePath(filePath: string, callback: (() => void) | undefined) {
        if (filePath) {
            this.filePath = filePath;
            this.updateMruFilePath();
            this.doSave(() => {
                this.saveUIState();
                if (callback) {
                    callback();
                }
            });
        }
    }

    saveToFile(saveAs: boolean, callback: (() => void) | undefined) {
        if (this.properties) {
            if (!this.filePath || saveAs) {
                EEZStudio.electron.remote.dialog.showSaveDialog(
                    EEZStudio.electron.remote.getCurrentWindow(),
                    {
                        filters: [
                            { name: "EEZ Project", extensions: ["eez-project"] },
                            { name: "All Files", extensions: ["*"] }
                        ]
                    },
                    (filePath: any) => this.savedAsFilePath(filePath, callback)
                );
            } else {
                this.doSave(callback);
            }
        }
    }

    newProject() {
        this.changeProject(undefined, getNewProject());
    }

    loadUIState(projectFilePath: string) {
        return new Promise<any>((resolve, reject) => {
            fs.readFile(getUIStateFilePath(projectFilePath), "utf8", (err: any, data: string) => {
                if (err) {
                    resolve({});
                } else {
                    resolve(JSON.parse(data));
                }
            });
        });
    }

    saveUIState() {
        if (this.filePath && UIStateStore.isModified) {
            fs.writeFile(
                getUIStateFilePath(this.filePath),
                UIStateStore.save(),
                "utf8",
                (err: any) => {
                    if (err) {
                        console.error(err);
                    } else {
                        console.log("UI state saved");
                    }
                }
            );
        }
    }

    openFile(filePath: string) {
        loadProject(filePath)
            .then(project => {
                this.loadUIState(filePath)
                    .then(uiState => {
                        this.changeProject(filePath, project, uiState);
                    })
                    .catch(error => console.error(error));
            })
            .catch(error => console.error(error));
    }

    open(sender: any, filePath: any) {
        if (!this.properties || (!this.filePath && !this.modified)) {
            this.openFile(filePath);
        }
    }

    saveModified(callback: any) {
        this.saveUIState();

        if (this.properties && this.modified) {
            confirmSave({
                saveCallback: () => {
                    this.saveToFile(false, callback);
                },

                dontSaveCallback: () => {
                    callback();
                },

                cancelCallback: () => {}
            });
        } else {
            callback();
        }
    }

    canSave() {
        return this.modified;
    }

    save() {
        this.saveToFile(false, undefined);
    }

    saveAs() {
        this.saveToFile(true, undefined);
    }

    check() {
        buildProject(true);
    }

    build() {
        buildProject(false);
    }

    closeWindow() {
        if (this.isOpen) {
            this.saveModified(() => {
                this.changeProject(undefined);
                EEZStudio.electron.ipcRenderer.send("readyToClose");
            });
        } else {
            EEZStudio.electron.ipcRenderer.send("readyToClose");
        }
    }

    noProject() {
        this.changeProject(undefined);
    }

    showMetrics() {
        const ID = "eez-project-editor-project-metrics";
        if (!document.getElementById(ID)) {
            showGenericDialog({
                dialogDefinition: {
                    id: ID,
                    title: "Project Metrics",
                    fields: [
                        {
                            name: "metrics",
                            fullLine: true,
                            type: TableField
                        }
                    ]
                },
                values: {
                    metrics: getAllMetrics()
                },
                showOkButton: false
            }).catch(() => {});
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

function initObject(parent: EezObject | undefined, child: EezObject, metaData: MetaData) {
    child.$eez = <any>{};

    if (parent) {
        if (!parent.$eez.lastChildId) {
            parent.$eez.lastChildId = 1;
        } else {
            ++parent.$eez.lastChildId;
        }
        child.$eez.parent = parent;
        child.$eez.id = parent.$eez.id + "." + parent.$eez.lastChildId;
    } else {
        child.$eez.parent = undefined;
        child.$eez.id = "1";
    }
    child.$eez.lastChildId = 0;

    child.$eez.metaData = metaData;
}

// TODO this is hack!!!
function makeArrayToActsAsEezObject(
    object: any,
    parent: EezObject,
    propertyMetaData: PropertyMetaData
) {
    initObject(parent, object, propertyMetaData.typeMetaData as MetaData);

    object.$eez.key = propertyMetaData.name;

    object.getParent = () => parent;
    object.getKey = () => propertyMetaData.name;
    object.check = () => {
        if (propertyMetaData.check) {
            return propertyMetaData.check(object);
        } else {
            return [];
        }
    };
}

function loadArrayObject(arrayObject: any, parent: any, propertyMetaData: PropertyMetaData) {
    makeArrayToActsAsEezObject(arrayObject, parent, propertyMetaData);

    for (let j = 0; j < arrayObject.length; ++j) {
        arrayObject[j] = loadObject(
            arrayObject,
            arrayObject[j],
            propertyMetaData.typeMetaData as MetaData
        );
    }
}

export let loadObject = action(
    (
        parent: EezObject | EezObject[] | undefined,
        jsObjectOrString: any | string,
        metaData: MetaData,
        key?: string
    ): EezObject => {
        let jsObject: any =
            typeof jsObjectOrString == "string" ? JSON.parse(jsObjectOrString) : jsObjectOrString;

        if (Array.isArray(jsObject)) {
            loadArrayObject(jsObject, parent, {
                type: "array",
                name: key!,
                typeMetaData: metaData
            });
            return jsObject as any;
        }

        let object = new (metaData.getClass(jsObject))();
        initObject(parent as EezObject, object, metaData);

        let properties = metaData.properties(jsObject);
        for (let i = 0; i < properties.length; ++i) {
            let propertyMetaData = properties[i];

            let value = jsObject[propertyMetaData.name];

            if (propertyMetaData.type == "object") {
                let childObject: EezObject | undefined;

                if (value) {
                    childObject = loadObject(
                        object,
                        value,
                        propertyMetaData.typeMetaData as MetaData
                    );
                } else if (!propertyMetaData.isOptional) {
                    let typeMetaData = propertyMetaData.typeMetaData as MetaData;
                    childObject = loadObject(parent, typeMetaData.defaultValue, typeMetaData);
                }

                if (childObject) {
                    childObject.$eez.key = propertyMetaData.name;
                    object[propertyMetaData.name] = childObject;
                }
            } else if (propertyMetaData.type == "array") {
                if (!value && !propertyMetaData.isOptional) {
                    value = [];
                }

                if (value) {
                    object[propertyMetaData.name] = observable(value);
                    let arrayObject = object[propertyMetaData.name];
                    loadArrayObject(arrayObject, object, propertyMetaData);
                }
            } else {
                object[propertyMetaData.name] = value;
            }
        }

        return object;
    }
);

export function objectToJson(object: EezObject, space?: number) {
    return JSON.stringify(
        toJS(object),
        (key: string, value: any) => (key !== "$eez" ? value : undefined),
        space
    );
}

export function objectToJS(object: EezObject): any {
    return JSON.parse(objectToJson(object));
}

export function cloneObject(parent: EezObject | undefined, obj: EezObject) {
    return loadObject(parent, objectToJson(obj), obj.$eez.metaData);
}

////////////////////////////////////////////////////////////////////////////////

export const EEZ_STUDIO_DATA_TYPE = "text/eez-studio-project-editor-data";

export interface SerializedData {
    className: string;
    metaData?: MetaData;
    object?: EezObject;
    objects?: EezObject[];
}

export function objectToClipboardData(object: EezObject): string {
    return JSON.stringify({
        className: object.$eez.metaData.className,
        object: objectToJson(object)
    });
}

export function objectsToClipboardData(objects: EezObject[]): string {
    return JSON.stringify({
        className: objects[0].$eez.metaData.className,
        objects: objects.map(object => objectToJson(object))
    });
}

export function clipboardDataToObject(data: string) {
    let serializedData: SerializedData = JSON.parse(data);

    serializedData.metaData = findMetaData(serializedData.className);

    if (serializedData.metaData) {
        const metaData = serializedData.metaData;
        if (serializedData.object) {
            serializedData.object = loadObject(undefined, serializedData.object, metaData);
        } else if (serializedData.objects) {
            serializedData.objects = serializedData.objects.map(object =>
                loadObject(undefined, object, metaData)
            );
        }
    }

    return serializedData;
}

let clipboardData: string;

export function setClipboardData(event: any, value: string) {
    clipboardData = value;
    event.dataTransfer.setData(EEZ_STUDIO_DATA_TYPE, clipboardData);
}

export function getEezStudioDataFromDragEvent(event: any) {
    let data = event.dataTransfer.getData(EEZ_STUDIO_DATA_TYPE);
    if (!data) {
        data = clipboardData;
    }
    if (data) {
        return clipboardDataToObject(data);
    }
    return undefined;
}

////////////////////////////////////////////////////////////////////////////////

export function isEqual(object1: EezObject, object2: EezObject) {
    if (isValue(object1)) {
        if (!isValue(object1)) {
            return false;
        }
        return object1.getParent() == object2.getParent() && object1.getKey() == object2.getKey();
    } else {
        if (isValue(object1)) {
            return false;
        }
        return object1 == object2;
    }
}

export function isValue(object: EezObject | undefined) {
    return !!object && object instanceof EezValueObject;
}

export function isObject(object: EezObject | undefined) {
    return !!object && !isValue(object) && !isArray(object);
}

export function isArray(object: EezObject | undefined) {
    return !!object && !isValue(object) && isObservableArray(object);
}

export function asArray(object: EezObject): EezObject[] {
    return (object as any) as EezObject[];
}

export function getChildren(parent: EezObject): EezObject[] {
    if (isArray(parent)) {
        return asArray(parent);
    } else {
        let properties = parent.$eez.metaData
            .properties(parent)
            .filter(
                propertyMetaData =>
                    (propertyMetaData.type == "object" || propertyMetaData.type == "array") &&
                    parent[propertyMetaData.name]
            );

        if (properties.length == 1 && properties[0].type == "array") {
            return asArray(parent[properties[0].name]);
        }

        return properties.map(propertyMetaData => parent[propertyMetaData.name]);
    }
}

export function getChildOfObject(
    object: EezObject,
    key: PropertyMetaData | string | number
): EezObject | undefined {
    let propertyMetaData: PropertyMetaData | undefined;

    if (isArray(object)) {
        if (typeof key == "string") {
            return object[parseInt(key)];
        } else if (typeof key == "number") {
            return object[key];
        } else {
            console.error("invalid key type");
        }
    } else {
        if (typeof key == "string") {
            propertyMetaData = findPropertyByName(object, key);
        } else if (typeof key == "number") {
            console.error("invalid key type");
        } else {
            propertyMetaData = key;
        }
    }

    if (propertyMetaData) {
        let childObjectOrValue = object[propertyMetaData.name];
        if (propertyMetaData.typeMetaData) {
            return childObjectOrValue;
        } else {
            return new EezValueObject(object, propertyMetaData, childObjectOrValue);
        }
    }

    return undefined;
}

export function getObjectPropertyAsObject(object: EezObject, propertyMetaData: PropertyMetaData) {
    return getChildOfObject(object, propertyMetaData) as EezValueObject;
}

export function getObjectFromObjectId(objectID: string): EezObject | undefined {
    function getDescendantObjectFromId(object: EezObject, id: string): EezObject | undefined {
        if (object.$eez.id == id) {
            return object;
        }

        if (isArray(object)) {
            let childObject = asArray(object).find(
                child => id == child.$eez.id || id.startsWith(child.$eez.id + ".")
            );
            if (childObject) {
                if (childObject.$eez.id == id) {
                    return childObject;
                }
                return getDescendantObjectFromId(childObject, id);
            }
        } else {
            let properties = object.$eez.metaData.properties(object);

            for (let i = 0; i < properties.length; ++i) {
                let propertyMetaData = properties[i];
                if (propertyMetaData.type == "object" || propertyMetaData.type == "array") {
                    let childObject = getChildOfObject(object, propertyMetaData);
                    if (childObject) {
                        if (childObject.$eez.id == id) {
                            return childObject;
                        }
                        if (id.startsWith(childObject.$eez.id + ".")) {
                            return getDescendantObjectFromId(childObject, id);
                        }
                    }
                }
            }
        }

        console.log("ups!!!");

        return undefined;
    }

    return getDescendantObjectFromId(ProjectStore.projectProperties, objectID as string);
}

export function hasAncestor(object: EezObject, ancestor: EezObject): boolean {
    if (object == undefined || ancestor == undefined) {
        return false;
    }

    if (object == ancestor) {
        return true;
    }

    let parent = object.getParent();
    return !!parent && hasAncestor(parent, ancestor);
}

export function hasProperAncestor(object: EezObject, ancestor: EezObject) {
    if (object == undefined || object == ancestor) {
        return false;
    }

    let parent = object.getParent();
    return !!parent && hasAncestor(parent, ancestor);
}

function uniqueTop(objects: EezObject[]): EezObject[] {
    return _uniqWith(
        objects,
        (a: EezObject, b: EezObject) => hasAncestor(a, b) || hasAncestor(b, a)
    );
}

function getParents(objects: EezObject[]): EezObject[] {
    return uniqueTop(objects
        .map(object => object.$eez.parent)
        .filter(object => !!object) as EezObject[]);
}

export function reduceUntilCommonParent(objects: EezObject[]): EezObject[] {
    let uniqueTopObjects = uniqueTop(objects);

    let parents = getParents(uniqueTopObjects);

    if (parents.length == 1) {
        return uniqueTopObjects;
    }

    if (parents.length > 1) {
        return reduceUntilCommonParent(parents);
    }

    return [];
}

export function isArrayElement(object: EezObject) {
    return isObservableArray(object.$eez.parent);
}

export function isSameInstanceTypeAs(object1: EezObject, object2: EezObject) {
    if (!object1 || !object2) {
        return false;
    }

    return object1.$eez.metaData == object2.$eez.metaData;
}

export function objectToString(object: EezObject) {
    let label: string;

    if (isValue(object)) {
        label = object.getParent()![object.getKey() as string];
    } else if (isArray(object)) {
        let propertyMetaData = findPropertyByName(object.getParent()!, object.getKey()!);
        label = (propertyMetaData && propertyMetaData.displayName) || humanize(object.getKey());
    } else {
        object = object;

        if (object.$eez.metaData.label) {
            label = object.$eez.metaData.label(object);
        } else {
            let name = object["name"];
            if (name) {
                label = humanize(name);
            }

            label = object.$eez.id;
        }
    }

    if (
        object &&
        object.$eez.parent &&
        isArray(object.$eez.parent) &&
        object.$eez.parent.$eez.key &&
        object.$eez.parent.$eez.parent
    ) {
        let propertyMetaData = findPropertyByName(
            object.$eez.parent.$eez.parent,
            object.$eez.parent.$eez.key
        );
        if (propertyMetaData && propertyMetaData.childLabel) {
            label = propertyMetaData.childLabel(object, label);
        }
    }

    return label;
}

export function getAncestorOfType(object: EezObject, metaData: MetaData): EezObject | undefined {
    if (object) {
        if (object.$eez.metaData == metaData) {
            return object;
        }
        return object.$eez.parent && getAncestorOfType(object.$eez.parent, metaData);
    }
    return undefined;
}

export function getObjectPath(object: EezObject): (string | number)[] {
    let parent = object.getParent();
    if (parent) {
        if (isArrayElement(object)) {
            return getObjectPath(parent).concat(asArray(parent).indexOf(object as EezObject));
        } else {
            return getObjectPath(parent).concat(object.getKey() as string);
        }
    }
    return [];
}

export function getObjectFromPath(path: string[]) {
    let object: EezObject = ProjectStore.projectProperties;

    for (let i = 0; i < path.length && object; ++i) {
        object = getChildOfObject(object, path[i]) as EezObject;
    }

    return object;
}

export function getObjectPathAsString(object: EezObject) {
    return "/" + getObjectPath(object).join("/");
}

export function getObjectFromStringPath(stringPath: string) {
    if (stringPath == "/") {
        return ProjectStore.projectProperties;
    }
    return getObjectFromPath(stringPath.split("/").slice(1));
}

export function getAncestors(
    object: EezObject,
    ancestor?: EezObject,
    showSingleArrayChild?: boolean
): EezObject[] {
    if (!ancestor) {
        ancestor = ProjectStore.projectProperties;
    }

    if (isValue(object)) {
        object = object.getParent() as EezObject;
    }

    if (isArray(ancestor)) {
        let possibleAncestor = ((ancestor as any) as EezObject[]).find(
            possibleAncestor =>
                object == possibleAncestor ||
                object.$eez.id.startsWith(possibleAncestor.$eez.id + ".")
        );
        if (possibleAncestor) {
            if (possibleAncestor == object) {
                if (showSingleArrayChild) {
                    return [ancestor, object];
                } else {
                    return [object];
                }
            } else {
                if (showSingleArrayChild) {
                    return [ancestor as EezObject].concat(getAncestors(object, possibleAncestor));
                } else {
                    return getAncestors(object, possibleAncestor);
                }
            }
        }
    } else {
        let properties = ancestor.$eez.metaData.properties(ancestor);

        let numObjectOrArrayProperties = 0;
        for (let i = 0; i < properties.length; ++i) {
            let propertyMetaData = properties[i];
            if (propertyMetaData.type == "object" || propertyMetaData.type == "array") {
                ++numObjectOrArrayProperties;
            }
        }

        if (numObjectOrArrayProperties > 0) {
            for (let i = 0; i < properties.length; ++i) {
                let propertyMetaData = properties[i];
                if (propertyMetaData.type == "object" || propertyMetaData.type == "array") {
                    let possibleAncestor: EezObject = (ancestor as any)[propertyMetaData.name];
                    if (possibleAncestor == object) {
                        return [];
                    }
                    if (
                        possibleAncestor &&
                        object.$eez.id.startsWith(possibleAncestor.$eez.id + ".")
                    ) {
                        return [ancestor].concat(
                            getAncestors(object, possibleAncestor, numObjectOrArrayProperties > 1)
                        );
                    }
                }
            }
        }
    }
    return [];
}

export function getHumanReadableObjectPath(object: EezObject) {
    let ancestors = getAncestors(object);
    return ancestors
        .slice(1)
        .map(object => objectToString(object))
        .join(" / ");
}

export function getObjectPropertiesMetaData(object: EezObject) {
    return object.$eez.metaData.properties(object);
}

export function isObjectInstanceOf(object: EezObject, eezMetaData: MetaData) {
    return object.$eez.metaData == eezMetaData;
}

export function getInheritedValue(object: EezObject, propertyName: string) {
    if (object.$eez.metaData.getInheritedValue) {
        return object.$eez.metaData.getInheritedValue(object, propertyName);
    }
    return undefined;
}

export function getPropertyAsString(object: EezObject, propertyMetaData: PropertyMetaData) {
    let value = object[propertyMetaData.name];
    if (value) {
        if (value instanceof EezObject) {
            return objectToString(value);
        }
        return value.toString();
    }
}

export function canAdd(object: EezObject) {
    return (isArrayElement(object) || isArray(object)) && object.$eez.metaData.newItem != undefined;
}

export function canDuplicate(object: EezObject) {
    return isArrayElement(object);
}

export function getProperties(object: EezObject) {
    return object.$eez.metaData.properties(object);
}

export function findPropertyByName(object: EezObject, propertyName: string) {
    return getProperties(object).find(propertyMetaData => propertyMetaData.name == propertyName);
}

export function humanizePropertyName(object: EezObject, propertyName: string) {
    const property = findPropertyByName(object, propertyName);
    if (property && property.displayName) {
        return property.displayName;
    }
    return humanize(propertyName);
}

function isOptional(object: EezObject) {
    let parent = object.$eez.parent;
    if (!parent) {
        return false;
    }

    let property: PropertyMetaData | undefined = findPropertyByName(parent, object.$eez
        .key as string);

    if (property == undefined) {
        return false;
    }

    return property.isOptional;
}

export function canDelete(object: EezObject) {
    return isArrayElement(object) || isOptional(object);
}

export function canCut(object: EezObject) {
    return canCopy(object) && canDelete(object);
}

export function canCopy(object: EezObject) {
    return isArrayElement(object) || isOptional(object);
}

export function canContainChildren(object: EezObject) {
    let properties = getProperties(object);

    for (let i = 0; i < properties.length; ++i) {
        let propertyMetaData = properties[i];
        if (propertyMetaData.type == "array" || propertyMetaData.type == "object") {
            return true;
        }
    }

    return false;
}

export function findPastePlaceInside(
    object: EezObject,
    metaData: MetaData,
    isSingleObject: boolean
) {
    if (isArray(object) && object.$eez.metaData == metaData) {
        return object;
    }

    if (isObject(object) && object.$eez.metaData.findPastePlaceInside) {
        return object.$eez.metaData.findPastePlaceInside(object, metaData, isSingleObject);
    }

    let properties = getProperties(object);

    // first, find among array properties
    for (let i = 0; i < properties.length; ++i) {
        let propertyMetaData = properties[i];
        if (propertyMetaData.type == "array" && propertyMetaData.typeMetaData == metaData) {
            let collectionObject = getChildOfObject(object, propertyMetaData);
            if (collectionObject) {
                return collectionObject;
            }
        }
    }

    // then, find among object properties
    for (let i = 0; i < properties.length; ++i) {
        let propertyMetaData = properties[i];
        if (
            propertyMetaData.type == "object" &&
            propertyMetaData.typeMetaData == metaData &&
            isSingleObject
        ) {
            let childObject = getChildOfObject(object, propertyMetaData);
            if (!childObject) {
                return propertyMetaData;
            }
        }
    }

    return undefined;
}

function findPastePlaceInsideAndOutside(object: EezObject, serializedData: SerializedData) {
    if (!serializedData.metaData) {
        return undefined;
    }

    let place = findPastePlaceInside(object, serializedData.metaData, !!serializedData.object);
    if (place) {
        return place;
    }

    let parent = object.getParent();
    return parent && findPastePlaceInside(parent, serializedData.metaData, !!serializedData.object);
}

export function checkClipboard(object: EezObject) {
    let text = EEZStudio.electron.remote.clipboard.readText();
    if (text) {
        let serializedData = clipboardDataToObject(atob(text));
        if (serializedData) {
            let pastePlace = findPastePlaceInsideAndOutside(object, serializedData);
            if (pastePlace) {
                return {
                    serializedData: serializedData,
                    pastePlace: pastePlace
                };
            }
        }
    }
    return undefined;
}

export function canPaste(object: EezObject) {
    try {
        return checkClipboard(object);
    } catch (e) {
        return undefined;
    }
}

////////////////////////////////////////////////////////////////////////////////

function getUniquePropertyValue(existingObjects: EezObject[], key: string, value: string) {
    while (true) {
        if (!existingObjects.find(object => object[key] == value)) {
            return value;
        }

        var groups = value.match(/(.+) \((\d+)\)/);
        if (groups) {
            value = groups[1] + " (" + (parseInt(groups[2]) + 1) + ")";
        } else {
            value += " (1)";
        }
    }
}

// ensure that unique properties are unique inside parent
function ensureUniqueProperties(parentObject: EezObject, objects: EezObject[]) {
    let existingObjects: EezObject[] = (parentObject as any).map((object: EezObject) => object);
    objects.forEach(object => {
        for (let propertyMetaData of object.$eez.metaData.properties(object)) {
            if (propertyMetaData.unique) {
                object[propertyMetaData.name] = getUniquePropertyValue(
                    existingObjects,
                    propertyMetaData.name,
                    object[propertyMetaData.name]
                );
            }
        }
        existingObjects.push(object);
    });
}

////////////////////////////////////////////////////////////////////////////////

function onObjectModified(object: EezObject) {
    object.$eez.modificationTime = new Date().getTime();
    if (object.$eez.parent) {
        onObjectModified(object.$eez.parent);
    }
}

////////////////////////////////////////////////////////////////////////////////

export let addObject = action((parentObject: any, object: EezObject) => {
    object = loadObject(parentObject, object, parentObject.$eez.metaData);
    ensureUniqueProperties(parentObject, [object]);

    UndoManager.executeCommand({
        execute: action(() => {
            (parentObject as any).push(object);
            onObjectModified(parentObject);
        }),

        undo: action(() => {
            (parentObject as any).pop();
        }),

        get description() {
            return "Added: " + getHumanReadableObjectPath(object);
        }
    });

    NavigationStore.setSelection([object]);

    return object;
});

export let addObjects = action((parentObject: EezObject, objects: EezObject[]) => {
    objects = objects.map(object => loadObject(parentObject, object, parentObject.$eez.metaData));
    ensureUniqueProperties(parentObject, objects);

    UndoManager.executeCommand({
        execute: action(() => {
            (parentObject as any).push.apply(parentObject, objects);
            onObjectModified(parentObject);
        }),

        undo: action(() => {
            for (let i = 0; i < objects.length; ++i) {
                (parentObject as any).pop();
            }
            onObjectModified(parentObject);
        }),

        get description() {
            return "Added: " + objects.map(object => getHumanReadableObjectPath(object)).join(", ");
        }
    });

    NavigationStore.setSelection(objects);
});

export let insertObject = action((parentObject: EezObject, index: number, object: EezObject) => {
    object = loadObject(parentObject, object, parentObject.$eez.metaData);
    ensureUniqueProperties(parentObject, [object]);

    UndoManager.executeCommand({
        execute: action(() => {
            (parentObject as any).splice(index, 0, object);
            onObjectModified(parentObject);
        }),

        undo: action(() => {
            (parentObject as any).splice(index, 1);
            onObjectModified(parentObject);
        }),

        get description() {
            return "Inserted: " + getHumanReadableObjectPath(object);
        }
    });

    NavigationStore.setSelection([object]);
});

class UpdateCommand implements Command {
    private oldValues: any = {};
    private newValues: any = {};

    constructor(public object: EezObject, private values: any, lastCommand?: UpdateCommand) {
        if (lastCommand) {
            this.oldValues = lastCommand.oldValues;
        }

        for (let propertyName in values) {
            let propertyMetaData = findPropertyByName(object, propertyName);
            if (propertyMetaData) {
                if (!lastCommand) {
                    this.oldValues[propertyName] = object[propertyName];
                }

                let value = values[propertyName];

                if (propertyMetaData.type == "number") {
                    if (value !== undefined) {
                        this.newValues[propertyName] = +value;
                    } else {
                        this.newValues[propertyName] = undefined;
                    }
                } else {
                    this.newValues[propertyName] = values[propertyName];
                }
            }
        }
    }

    static assignValues(dest: any, src: any) {
        for (let propertyName in src) {
            dest[propertyName] = src[propertyName];

            // in case of array, mobx will not copy our injected properties like $eez, getKey, ...
            // so we must do it manually
            if (isArray(dest[propertyName])) {
                dest[propertyName].$eez = src[propertyName].$eez;
                dest[propertyName].getKey = src[propertyName].getKey;
                dest[propertyName].getParent = src[propertyName].getParent;
                dest[propertyName].check = src[propertyName].check;
            }
        }
    }

    @action
    execute() {
        UpdateCommand.assignValues(this.object, this.newValues);
        onObjectModified(this.object);
    }

    @action
    undo() {
        UpdateCommand.assignValues(this.object, this.oldValues);
        onObjectModified(this.object);
    }

    @computed
    get description() {
        return (
            `Changed (${_map(this.values, (value, name) => humanize(name)).join(", ")}): ` +
            getHumanReadableObjectPath(this.object)
        );
    }
}

export let updateObject = action((object: EezObject, values: any) => {
    let previousCommand;

    if (UndoManager.combineCommands && UndoManager.commands.length > 0) {
        let command = UndoManager.commands[UndoManager.commands.length - 1];
        if (command instanceof UpdateCommand && command.object == object) {
            // merge with previous command
            UndoManager.commands.pop();
            previousCommand = command;
        }
    }

    UndoManager.executeCommand(new UpdateCommand(object, values, previousCommand));
});

export let deleteObject = action((object: any) => {
    if (isArrayElement(object)) {
        let parent = object.$eez.parent as any;
        let index = parent.indexOf(object);

        UndoManager.executeCommand({
            execute: action(() => {
                parent.splice(index, 1);
                onObjectModified(parent);
            }),

            undo: action(() => {
                parent.splice(index, 0, object);
                onObjectModified(parent);
            }),

            get description() {
                return "Deleted: " + getHumanReadableObjectPath(object);
            }
        });

        if (parent.length > 0) {
            if (index == parent.length) {
                NavigationStore.setSelection([parent[index - 1]]);
            } else {
                NavigationStore.setSelection([parent[index]]);
            }
        } else {
            NavigationStore.setSelection([parent]);
        }
    } else {
        updateObject(object, {
            [object.$eez.key as string]: undefined
        });
    }
});

export let deleteObjects = action((objects: EezObject[]) => {
    let undoIndexes: number[];

    UndoManager.executeCommand({
        execute: action(() => {
            undoIndexes = [];
            for (let i = 0; i < objects.length; ++i) {
                let object = objects[i];
                let parent = object.$eez.parent as any;
                if (isArrayElement(object)) {
                    let index = parent.indexOf(object);
                    undoIndexes.push(index);
                    parent.splice(index, 1);
                } else {
                    undoIndexes.push(-1);
                    parent[object.$eez.key as string] = undefined;
                }
                onObjectModified(parent);
            }
        }),

        undo: action(() => {
            for (let i = objects.length - 1; i >= 0; --i) {
                let object = objects[i];
                let parent = object.$eez.parent as any;
                if (isArrayElement(object)) {
                    let index = undoIndexes[i];
                    parent.splice(index, 0, object);
                } else {
                    parent[object.$eez.key as string] = object;
                }
                onObjectModified(parent);
            }
        }),

        get description() {
            return (
                "Deleted: " + objects.map(object => getHumanReadableObjectPath(object)).join(", ")
            );
        }
    });
});

export let replaceObject = action((object: EezObject, replaceWithObject: EezObject) => {
    replaceWithObject.$eez.id = object.$eez.id;
    replaceWithObject.$eez.key = object.$eez.key;
    replaceWithObject.$eez.parent = object.$eez.parent;

    let parent = object.$eez.parent as any;
    if (isArrayElement(object)) {
        let index = parent.indexOf(object);

        UndoManager.executeCommand({
            execute: action(() => {
                parent[index] = replaceWithObject;
            }),

            undo: action(() => {
                parent[index] = object;
            }),

            get description() {
                return "Replaced: " + getHumanReadableObjectPath(object);
            }
        });

        NavigationStore.setSelection([replaceWithObject]);
    } else {
        updateObject(parent as any, {
            [object.$eez.key as string]: replaceWithObject
        });
    }
});

export let replaceObjects = action((objects: EezObject[], replaceWithObject: EezObject) => {
    let parent = objects[0].getParent() as any;
    let index = parent.indexOf(objects[0]);

    replaceWithObject.$eez.id = objects[0].$eez.id;
    replaceWithObject.$eez.key = objects[0].$eez.key;
    replaceWithObject.$eez.parent = parent;

    let undoIndexes: number[];

    UndoManager.executeCommand({
        execute: action(() => {
            parent[index] = replaceWithObject;

            undoIndexes = [];
            for (let i = 1; i < objects.length; ++i) {
                let object = objects[i];
                let index = parent.indexOf(object);
                undoIndexes.push(index);
                parent.splice(index, 1);
            }
        }),

        undo: action(() => {
            for (let i = objects.length - 1; i >= 1; --i) {
                let object = objects[i];
                let index = undoIndexes[i - 1];
                parent.splice(index, 0, object);
            }

            parent[index] = objects[0];
        }),

        get description() {
            return (
                "Replaced: " + objects.map(object => getHumanReadableObjectPath(object)).join(", ")
            );
        }
    });

    NavigationStore.setSelection([replaceWithObject]);
});

////////////////////////////////////////////////////////////////////////////////

export function insertObjectBefore(object: EezObject, objectToInsert: EezObject) {
    let parent = object.getParent() as any;
    let index = parent.indexOf(object);
    insertObject(parent, index, objectToInsert);
}

export function insertObjectAfter(object: EezObject, objectToInsert: EezObject) {
    let parent = object.getParent() as any;
    let index = parent.indexOf(object);
    insertObject(parent, index + 1, objectToInsert);
}

////////////////////////////////////////////////////////////////////////////////

export function addItem(object: EezObject) {
    const parent = isArray(object) ? object : object.$eez.parent;
    if (parent && parent.$eez.metaData.newItem) {
        parent.$eez.metaData.newItem(parent).then(
            object => {
                addObject(parent, object);
            },
            () => {
                // do nothing on reject
            }
        );
    }
}

export function pasteItem(object: EezObject) {
    try {
        let c = checkClipboard(object);
        if (c) {
            if (typeof c.pastePlace == "string") {
                updateObject(object, {
                    [(c.pastePlace as PropertyMetaData).name]: c.serializedData.object
                });
            } else {
                if (c.serializedData.object) {
                    addObject(c.pastePlace as EezObject, c.serializedData.object);
                } else if (c.serializedData.objects) {
                    addObjects(c.pastePlace as EezObject, c.serializedData.objects);
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

export function deleteItem(object: EezObject) {
    deleteItems([object]);
}

export function cutItem(object: EezObject) {
    let clipboardText = btoa(objectToClipboardData(object));

    deleteItems([object], () => {
        EEZStudio.electron.remote.clipboard.write({
            text: clipboardText
        });
    });
}

export function copyItem(object: EezObject) {
    EEZStudio.electron.remote.clipboard.write({
        text: btoa(objectToClipboardData(object))
    });
}

function duplicateItem(object: EezObject) {
    let parent = object.getParent() as EezObject;
    let duplicate = cloneObject(parent, object);
    addObject(parent, duplicate);
}

export function showContextMenu(object: EezObject) {
    let menuItems: Electron.MenuItem[] = [];

    if (canAdd(object)) {
        menuItems.push(
            new MenuItem({
                label: "Add",
                click: () => {
                    addItem(object);
                }
            })
        );
    }

    if (canDuplicate(object)) {
        menuItems.push(
            new MenuItem({
                label: "Duplicate",
                click: () => {
                    duplicateItem(object);
                }
            })
        );
    }

    if (isArrayElement(object)) {
        if (menuItems.length > 0) {
            menuItems.push(
                new MenuItem({
                    type: "separator"
                })
            );
        }

        menuItems.push(
            new MenuItem({
                label: "Find All References",
                click: () => {
                    findAllReferences(object);
                }
            })
        );
    }

    let clipboardMenuItems: Electron.MenuItem[] = [];

    if (canCut(object)) {
        clipboardMenuItems.push(
            new MenuItem({
                label: "Cut",
                click: () => {
                    cutItem(object);
                }
            })
        );
    }

    if (canCopy(object)) {
        clipboardMenuItems.push(
            new MenuItem({
                label: "Copy",
                click: () => {
                    copyItem(object);
                }
            })
        );
    }

    if (canPaste(object)) {
        clipboardMenuItems.push(
            new MenuItem({
                label: "Paste",
                click: () => {
                    pasteItem(object);
                }
            })
        );
    }

    if (clipboardMenuItems.length > 0) {
        if (menuItems.length > 0) {
            menuItems.push(
                new MenuItem({
                    type: "separator"
                })
            );
        }
        menuItems = menuItems.concat(clipboardMenuItems);
    }

    if (canDelete(object)) {
        if (menuItems.length > 0) {
            menuItems.push(
                new MenuItem({
                    type: "separator"
                })
            );
        }

        menuItems.push(
            new MenuItem({
                label: "Delete",
                click: () => {
                    deleteItems([object]);
                }
            })
        );
    }

    if (object.extendContextMenu) {
        object.extendContextMenu([object], menuItems);
    }

    if (menuItems.length > 0) {
        const menu = new Menu();
        menuItems.forEach(menuItem => menu.append(menuItem));
        menu.popup({});
    }
}

////////////////////////////////////////////////////////////////////////////////

export function deleteItems(objects: EezObject[], callback?: () => void) {
    function doDelete() {
        deleteObjects(objects);
        if (callback) {
            callback();
        }
    }

    if (objects.length === 1) {
        if (isReferenced(objects[0])) {
            confirm(
                "Are you sure you want to delete this item?",
                "It is used in project.",
                doDelete
            );
        } else {
            doDelete();
        }
    } else {
        let isAnyItemReferenced = false;

        for (let i = 0; i < objects.length; ++i) {
            if (isReferenced(objects[i])) {
                isAnyItemReferenced = true;
                break;
            }
        }

        if (isAnyItemReferenced) {
            confirm(
                "Are you sure you want to delete this items?",
                "Some of them are used in project.",
                doDelete
            );
        } else {
            doDelete();
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

export function init() {
    EEZStudio.electron.ipcRenderer.on("newProject", () => ProjectStore.newProject());

    EEZStudio.electron.ipcRenderer.on("open", (sender: any, filePath: any) =>
        ProjectStore.open(sender, filePath)
    );

    EEZStudio.electron.ipcRenderer.on("save", () => ProjectStore.save());
    EEZStudio.electron.ipcRenderer.on("saveAs", () => ProjectStore.saveAs());

    EEZStudio.electron.ipcRenderer.on("check", () => ProjectStore.check());
    EEZStudio.electron.ipcRenderer.on("build", () => ProjectStore.build());

    EEZStudio.electron.ipcRenderer.on("undo", () => UndoManager.undo());
    EEZStudio.electron.ipcRenderer.on("redo", () => UndoManager.redo());

    // EEZStudio.electron.ipcRenderer.on('cut', () => ProjectStore.selection.cutSelection());
    // EEZStudio.electron.ipcRenderer.on('copy', () => ProjectStore.selection.copySelection());
    // EEZStudio.electron.ipcRenderer.on('paste', () => ProjectStore.selection.pasteSelection());
    // EEZStudio.electron.ipcRenderer.on('delete', () => ProjectStore.selection.deleteSelection());

    // EEZStudio.electron.ipcRenderer.on('goBack', () => ProjectStore.selection.selectionGoBack());
    // EEZStudio.electron.ipcRenderer.on('goForward', () => ProjectStore.selection.selectionGoForward());

    EEZStudio.electron.ipcRenderer.on(
        "toggleNavigation",
        action(
            () =>
                (UIStateStore.viewOptions.navigationVisible = !UIStateStore.viewOptions
                    .navigationVisible)
        )
    );
    EEZStudio.electron.ipcRenderer.on(
        "toggleOutput",
        action(
            () => (UIStateStore.viewOptions.outputVisible = !UIStateStore.viewOptions.outputVisible)
        )
    );
    EEZStudio.electron.ipcRenderer.on(
        "toggleProperties",
        action(
            () =>
                (UIStateStore.viewOptions.propertiesVisible = !UIStateStore.viewOptions
                    .propertiesVisible)
        )
    );
    EEZStudio.electron.ipcRenderer.on(
        "toggleDebug",
        action(
            () => (UIStateStore.viewOptions.debugVisible = !UIStateStore.viewOptions.debugVisible)
        )
    );

    EEZStudio.electron.ipcRenderer.on("showProjectMetrics", () => ProjectStore.showMetrics());

    if (window.location.search == "?mru") {
        let mruFilePath = ipcRenderer.sendSync("getMruFilePath");
        if (mruFilePath) {
            ProjectStore.openFile(mruFilePath);
        } else {
            ProjectStore.newProject();
        }
    } else if (window.location.search.startsWith("?open=")) {
        let ProjectStorePath = decodeURIComponent(
            window.location.search.substring("?open=".length)
        );
        ProjectStore.openFile(ProjectStorePath);
    } else if (window.location.search.startsWith("?new")) {
        ProjectStore.newProject();
    } else {
        ProjectStore.noProject();
    }
}

////////////////////////////////////////////////////////////////////////////////

export let ProjectStore = new ProjectStoreClass();
export let NavigationStore = new NavigationStoreClass();
export let EditorsStore = new EditorsStoreClass();
export let OutputSectionsStore = new OutputSections();
export let UIStateStore = new UIStateStoreClass();
export let UndoManager = new UndoManagerClass();

(<any>window).EezStudio = {
    NavigationStore,
    EditorsStore,
    OutputSectionsStore,
    UIStateStore,
    UndoManager,
    ProjectStore
};
