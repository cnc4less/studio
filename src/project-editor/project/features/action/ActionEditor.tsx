import { observer } from "mobx-react";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { bind } from "bind-decorator";

import { CodeEditor } from "shared/ui/code-editor";

import { EditorComponent } from "project-editor/core/metaData";
import { UndoManager, updateObject } from "project-editor/core/store";
import { ActionProperties } from "project-editor/project/features/action/action";

////////////////////////////////////////////////////////////////////////////////

@observer
export class GraphicalImplementationEditor extends React.Component<{}, {}> {
    render() {
        return <div />;
    }
}

////////////////////////////////////////////////////////////////////////////////

interface NativeImplementationEditorProps {
    action: ActionProperties;
}

@observer
export class NativeImplementationEditor extends React.Component<
    NativeImplementationEditorProps,
    {}
> {
    codeEditor: CodeEditor;

    @bind
    onChange(value: string) {
        updateObject(this.props.action, {
            implementation: value
        });
    }

    @bind
    onFocus() {
        UndoManager.setCombineCommands(true);
    }

    @bind
    onBlur() {
        UndoManager.setCombineCommands(false);
    }

    componentDidMount() {
        $(ReactDOM.findDOMNode(this.codeEditor) as Element).on("autoLayout:resize", () => {
            this.codeEditor.resize();
        });
    }

    componentWillUnmount() {
        $(ReactDOM.findDOMNode(this.codeEditor) as Element).off("autoLayout:resize");
    }

    render() {
        return (
            <CodeEditor
                ref={ref => (this.codeEditor = ref!)}
                mode="c_cpp"
                value={this.props.action.implementation || ""}
                onChange={this.onChange}
                onFocus={this.onFocus}
                onBlur={this.onBlur}
                className="layoutCenter"
            />
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

@observer
export class ActionEditor extends EditorComponent {
    render() {
        let action = this.props.editor.object as ActionProperties;

        if (action.implementationType == "graphical") {
            return <GraphicalImplementationEditor />;
        } else if (action.implementationType == "native") {
            return <NativeImplementationEditor action={action} />;
        } else {
            return <div />;
        }
    }
}
