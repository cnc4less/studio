import * as React from "react";
import { observable, computed, action } from "mobx";
import { observer } from "mobx-react";
import { clipboard, nativeImage, SaveDialogOptions } from "electron";
import * as VisibilitySensor from "react-visibility-sensor";
import { bind } from "bind-decorator";

import {
    writeBinaryData,
    formatTransferSpeed,
    getFileName,
    formatBytes,
    formatDateTimeLong
} from "shared/util";

import * as notification from "shared/ui/notification";

import { beginTransaction, commitTransaction } from "shared/store";
import { SAMPLING_RATE_UNIT } from "shared/units";
import { IActivityLogEntry, logUpdate } from "shared/activity-log";

import * as UiPropertiesModule from "shared/ui/properties";
import { Balloon } from "shared/ui/balloon";
import { PropertyList, StaticRichTextProperty } from "shared/ui/properties";
import { Toolbar } from "shared/ui/toolbar";
import { IconAction, TextAction } from "shared/ui/action";
import { VerticalHeaderWithBody, Header, Body } from "shared/ui/header-with-body";
import { Icon } from "shared/ui/icon";
import * as UiBalloonModule from "shared/ui/balloon";

import { FileState } from "instrument/connection/file-state";

import { AppStore } from "instrument/window/app-store";

import { showAddNoteDialog, showEditNoteDialog } from "instrument/window/note-dialog";

import { HistoryItem } from "instrument/window/history/item";

////////////////////////////////////////////////////////////////////////////////

@observer
class ImagePreview extends React.Component<
    {
        src: string;
    },
    {}
> {
    @observable zoom: boolean = false;

    @action.bound
    toggleZoom() {
        this.zoom = !this.zoom;
    }

    render() {
        const img = <img src={this.props.src} onClick={this.toggleZoom} />;

        if (this.zoom) {
            return (
                <VerticalHeaderWithBody className="EezStudio_ImagePreview zoom">
                    <Header>
                        <Toolbar />
                        <Toolbar>
                            <IconAction
                                icon="material:close"
                                iconSize={24}
                                title="Leave full screen mode"
                                onClick={this.toggleZoom}
                            />
                        </Toolbar>
                    </Header>
                    <Body>{img}</Body>
                </VerticalHeaderWithBody>
            );
        } else {
            return <div className="EezStudio_ImagePreview">{img}</div>;
        }
    }
}

@observer
export class FileHistoryItemComponent extends React.Component<
    {
        appStore: AppStore;
        historyItem: FileHistoryItem;
    },
    {}
> {
    element: HTMLDivElement | null;

    @action.bound
    onVisibilityChange(isVisible: boolean) {
        this.props.historyItem.isVisible = isVisible;
    }

    @bind
    onAbortFileTransfer() {
        this.props.appStore.instrument!.connection.abortLongOperation();
    }

    @bind
    onAddNote() {
        showAddNoteDialog(note => {
            beginTransaction("Add file note");
            this.props.historyItem.note = note;
            commitTransaction();
        });
    }

    @bind
    onEditNote() {
        showEditNoteDialog(this.props.historyItem.note!, note => {
            if (this.props.historyItem.note !== note) {
                beginTransaction("Edit file note");
                this.props.historyItem.note = note;
                commitTransaction();
            }
        });
    }

    @bind
    onDeleteNote() {
        beginTransaction("Delete file note");
        this.props.historyItem.note = undefined;
        commitTransaction();
    }

    @bind
    onSave() {
        let filters = [];

        let fileExtension;
        if (typeof this.props.historyItem.fileType === "string") {
            if (this.props.historyItem.fileType === "image") {
                fileExtension = "png";
            } else if (this.props.historyItem.fileType.startsWith("image/")) {
                fileExtension = this.props.historyItem.fileType.slice("image/".length);
            } else if (this.props.historyItem.fileType === "CSV") {
                fileExtension = "csv";
            }
        } else {
            fileExtension = this.props.historyItem.fileType.ext;
        }

        if (fileExtension) {
            filters.push({
                name: fileExtension.toUpperCase() + " Files",
                extensions: [fileExtension]
            });
        }

        filters.push({ name: "All Files", extensions: ["*"] });

        let options: SaveDialogOptions = {
            filters: filters
        };
        if (this.props.historyItem.sourceFilePath) {
            options.defaultPath = getFileName(this.props.historyItem.sourceFilePath);
        }

        EEZStudio.electron.remote.dialog.showSaveDialog(
            EEZStudio.electron.remote.getCurrentWindow(),
            options,
            async (filePath: any) => {
                if (filePath) {
                    await writeBinaryData(filePath, this.props.historyItem.data);
                    notification.success(`Saved to "${filePath}"`);
                }
            }
        );
    }

    @bind
    onCopy() {
        if (this.props.historyItem.isImage) {
            let image = nativeImage.createFromBuffer(
                Buffer.from(this.props.historyItem.data, "binary")
            );
            clipboard.writeImage(image);
            notification.success("Image copied to the clipboard");
        } else if (this.props.historyItem.isText) {
            clipboard.writeText(this.props.historyItem.data);
            notification.success("Text copied to the clipboard");
        }
    }

    getDirectionInfo() {
        if (this.props.historyItem.direction === "upload") {
            return "Sending file ...";
        } else if (this.props.historyItem.direction === "download") {
            return "Receiving file ...";
        } else {
            return "Attaching file ...";
        }
    }

    render() {
        let body;
        if (
            !this.props.historyItem.state ||
            this.props.historyItem.state === "init" ||
            this.props.historyItem.state === "upload-filesize" ||
            this.props.historyItem.state === "upload-start"
        ) {
            body = <div>{this.getDirectionInfo()}</div>;
        } else if (this.props.historyItem.state === "progress") {
            let percent = this.props.historyItem.expectedDataLength
                ? Math.floor(
                      100 *
                          this.props.historyItem.dataLength /
                          this.props.historyItem.expectedDataLength
                  )
                : 0;
            let transferSpeed = formatTransferSpeed(this.props.historyItem.transferSpeed);
            body = (
                <div>
                    <div>{this.getDirectionInfo()}</div>
                    <div>
                        {`${percent}% (${this.props.historyItem.dataLength} of ${
                            this.props.historyItem.expectedDataLength
                        }) ${transferSpeed}`}
                    </div>
                    {this.props.historyItem.direction === "upload" && (
                        <Toolbar>
                            <TextAction
                                text="Abort"
                                title="Abort file transfer"
                                onClick={this.onAbortFileTransfer}
                            />
                        </Toolbar>
                    )}
                </div>
            );
        } else if (
            this.props.historyItem.state === "error" ||
            this.props.historyItem.state === "upload-error"
        ) {
            body = (
                <div className="text-danger">
                    <div>Failed!</div>
                    <div>{this.props.historyItem.error}</div>
                </div>
            );
        } else if (this.props.historyItem.state === "timeout") {
            body = (
                <div className="text-danger">
                    <div>Timeout!</div>
                </div>
            );
        } else if (this.props.historyItem.state === "abort") {
            body = (
                <div className="text-danger">
                    <div>Aborted!</div>
                </div>
            );
        } else if (this.props.historyItem.transferSucceeded) {
            let preview: JSX.Element | null = null;
            let actions;

            if (this.props.historyItem.fileType) {
                preview = this.props.historyItem.previewElement;

                actions = (
                    <Toolbar>
                        <IconAction icon="material:save" title="Save file" onClick={this.onSave} />
                        <IconAction
                            icon="material:content_copy"
                            title="Copy to clipboard"
                            onClick={this.onCopy}
                        />
                        {!this.props.historyItem.note && (
                            <IconAction
                                icon="material:comment"
                                title="Add note"
                                onClick={this.onAddNote}
                            />
                        )}
                    </Toolbar>
                );
            }

            let note;
            if (this.props.historyItem.note) {
                note = (
                    <div
                        className="EezStudio_HistoryItem_File_Note"
                        onDoubleClick={this.onEditNote}
                    >
                        <Balloon>
                            <PropertyList>
                                <StaticRichTextProperty value={this.props.historyItem.note} />
                            </PropertyList>
                        </Balloon>
                        <Toolbar>
                            <IconAction
                                icon="material:edit"
                                title="Edit note"
                                onClick={this.onEditNote}
                            />
                            <IconAction
                                icon="material:delete"
                                title="Delete note"
                                onClick={this.onDeleteNote}
                            />
                        </Toolbar>
                    </div>
                );
            }

            body = (
                <div>
                    <div className="EezStudio_HistoryItemText mb-1">
                        {this.props.historyItem.sourceFilePath && (
                            <div style={{ display: "flex", alignItems: "center" }}>
                                <div>{this.props.historyItem.sourceFilePath}</div>
                                {this.props.historyItem.destinationFilePath && (
                                    <React.Fragment>
                                        <Icon icon="material:arrow_forward" />
                                        <div>{this.props.historyItem.destinationFilePath}</div>
                                    </React.Fragment>
                                )}
                            </div>
                        )}
                        <div className="mb-1">
                            {this.props.historyItem.fileTypeAsDisplayString +
                                ", " +
                                formatBytes(this.props.historyItem.fileLength)}
                        </div>
                        {this.props.historyItem.description}
                    </div>
                    {preview}
                    {actions}
                    {note}
                </div>
            );
        } else {
            body = this.props.historyItem.state;
        }

        return (
            <VisibilitySensor partialVisibility={true} onChange={this.onVisibilityChange}>
                <div
                    ref={ref => (this.element = ref)}
                    className="EezStudio_HistoryItem EezStudio_HistoryItem_File"
                >
                    <Icon
                        className="mr-3"
                        icon={
                            this.props.historyItem.direction === "upload"
                                ? "material:file_upload"
                                : this.props.historyItem.direction === "download"
                                    ? "material:file_download"
                                    : "material:attach_file"
                        }
                        size={48}
                    />
                    <div>
                        <p>
                            <small className="EezStudio_HistoryItemDate text-muted">
                                {formatDateTimeLong(this.props.historyItem.date)}
                            </small>
                        </p>

                        {body}
                    </div>
                </div>
            </VisibilitySensor>
        );
    }
}

export class FileHistoryItem extends HistoryItem {
    constructor(activityLogEntry: IActivityLogEntry, appStore?: AppStore) {
        super(activityLogEntry, appStore);
    }

    get info() {
        let note;
        if (this.note) {
            const {
                PropertyList,
                StaticRichTextProperty
            } = require("shared/ui/properties") as typeof UiPropertiesModule;

            const { Balloon } = require("shared/ui/balloon") as typeof UiBalloonModule;

            note = (
                <Balloon>
                    <PropertyList>
                        <StaticRichTextProperty value={this.note} />
                    </PropertyList>
                </Balloon>
            );
        }

        return (
            <React.Fragment>
                <div className="plain-text">{this.fileTypeAsDisplayString + " file"}</div>
                {note}
            </React.Fragment>
        );
    }

    get listItemElement(): JSX.Element | null {
        return <FileHistoryItemComponent appStore={this.appStore!} historyItem={this} />;
    }

    get previewElement(): JSX.Element | null {
        if (this.isImage) {
            let imageData =
                "data:image/png;base64," + Buffer.from(this.data, "binary").toString("base64");
            return <ImagePreview src={imageData} />;
        }
        return null;
    }

    @computed
    get fileState(): FileState {
        return JSON.parse(this.message);
    }

    @computed
    get fileLength() {
        if (typeof this.fileState.dataLength === "number") {
            return this.fileState.dataLength;
        }

        if (this.data) {
            return this.data.length;
        }

        return 0;
    }

    @computed
    get note() {
        return this.fileState.note;
    }

    set note(value: string | undefined) {
        let fileState = JSON.parse(this.message);

        fileState.note = value;

        logUpdate(
            {
                id: this.id,
                oid: this.appStore!.instrument!.id,
                message: JSON.stringify(fileState)
            },
            {
                undoable: true
            }
        );
    }

    @computed
    get fileType() {
        return this.fileState.fileType;
    }

    @computed
    get fileTypeAsDisplayString() {
        if (!this.fileType) {
            return "unknown";
        }

        if (typeof this.fileType === "string") {
            return this.fileType;
        }

        return this.fileType.mime;
    }

    @computed
    get sourceFilePath() {
        return this.fileState.sourceFilePath;
    }

    @computed
    get destinationFilePath() {
        return this.fileState.destinationFilePath;
    }

    @computed
    get isImage() {
        if (!this.fileType) {
            return false;
        }

        if (typeof this.fileType === "string") {
            return this.fileType.startsWith("image");
        }

        return this.fileType.mime.startsWith("image");
    }

    @computed
    get isText() {
        if (!this.fileType) {
            return false;
        }

        if (typeof this.fileType === "string") {
            return this.fileType === "CSV";
        }

        return this.fileType.mime.startsWith("text");
    }

    @computed
    get direction() {
        if (this.type === "instrument/file-download") {
            return "download";
        }
        if (this.type === "instrument/file-upload") {
            return "upload";
        }
        return "attachment";
    }

    @computed
    get state() {
        return this.fileState.state;
    }

    @computed
    get transferSucceeded() {
        return this.state === "success" || this.state === "upload-finish";
    }

    @computed
    get expectedDataLength() {
        return this.fileState.expectedDataLength;
    }

    @computed
    get dataLength() {
        return this.fileState.dataLength;
    }

    @computed
    get transferSpeed() {
        return this.fileState.transferSpeed;
    }

    @computed
    get error() {
        return this.fileState.error;
    }

    @computed
    get description() {
        if (!this.fileState.description) {
            return null;
        }

        let index = this.fileState.description.indexOf(", Preamble:");
        if (index === -1) {
            return <p>{this.fileState.description}</p>;
        }

        let firstRow = this.fileState.description.slice(0, index);

        try {
            // add unit to sample rate
            firstRow = firstRow.replace(/(.*Sampling rate: )(.*)/, (match, a, b) => {
                return a + SAMPLING_RATE_UNIT.formatValue(parseFloat(b), 0, " ");
            });
        } catch (err) {
            console.error(err);
        }

        let secondRow = this.fileState.description
            .slice(index + 2)
            .split(",")
            .join(", ");

        return (
            <React.Fragment>
                <p>{firstRow}</p>
                <p>{secondRow}</p>
            </React.Fragment>
        );
    }

    @observable isVisible: boolean;
}
