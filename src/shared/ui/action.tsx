import * as React from "react";
import * as classNames from "classnames";
import { observer } from "mobx-react";
import { bind } from "bind-decorator";

import { Icon } from "shared/ui/icon";

@observer
class Action extends React.Component<
    {
        title: string;
        onClick?: (event: any) => void;
        selected?: boolean;
        className?: string;
        style?: React.CSSProperties;
        enabled?: boolean;
    },
    {}
> {
    @bind
    onClick(event: any) {
        event.target.blur();
        if (this.props.onClick) {
            event.stopPropagation();
            event.preventDefault();
            this.props.onClick(event);
        }
    }

    render() {
        let className = classNames("EezStudio_Action", this.props.className, {
            EezStudio_SelectedAction: this.props.selected === true
        });

        const { title } = this.props;

        let buttonProps = {
            className,
            title,
            onClick: this.onClick,
            disabled: this.props.enabled === false,
            style: this.props.style
        };

        return <button {...buttonProps}>{this.props.children}</button>;
    }
}

@observer
export class TextAction extends React.Component<
    { text: string; title: string; onClick: () => void; selected?: boolean },
    {}
> {
    render() {
        return (
            <Action className="EezStudio_TextAction" {...this.props}>
                {this.props.text}
            </Action>
        );
    }
}

@observer
export class IconAction extends React.Component<
    {
        icon: string;
        iconSize?: number;
        title: string;
        onClick?: (event: any) => void;
        selected?: boolean;
        enabled?: boolean;
        style?: React.CSSProperties;
    },
    {}
> {
    render() {
        return (
            <Action className="EezStudio_IconAction" {...this.props}>
                <Icon icon={this.props.icon} size={this.props.iconSize} />
            </Action>
        );
    }
}

@observer
export class ButtonAction extends React.Component<
    {
        text: string;
        icon?: string;
        iconSize?: number;
        title: string;
        onClick?: (event: any) => void;
        enabled?: boolean;
        className?: string;
        style?: React.CSSProperties;
    },
    {}
> {
    render() {
        const { style, icon, iconSize, text } = this.props;
        let className = classNames("EezStudio_ButtonAction btn", this.props.className);

        return (
            <Action {...this.props} className={className} style={style}>
                {icon && <Icon icon={icon} size={iconSize} style={{ marginRight: 10 }} />}
                {text}
            </Action>
        );
    }
}

@observer
export class DropdownButtonAction extends React.Component<
    {
        text: string;
        icon?: string;
        iconSize?: number;
        title: string;
        onClick?: (event: any) => void;
        enabled?: boolean;
        className?: string;
        style?: React.CSSProperties;
        dropdown?: boolean;
    },
    {}
> {
    render() {
        const { style, icon, iconSize, text, title, onClick, enabled } = this.props;
        let className = classNames(
            "EezStudio_ButtonAction btn dropdown-toggle",
            this.props.className
        );

        let buttonProps = {
            className,
            title,
            onClick: onClick,
            disabled: enabled === false,
            style: style
        };

        return (
            <div className="dropdown">
                <button
                    {...buttonProps}
                    data-toggle="dropdown"
                    aria-haspopup="true"
                    aria-expanded="false"
                >
                    {icon && <Icon icon={icon} size={iconSize} style={{ marginRight: 10 }} />}
                    {text}
                </button>
                <div className="dropdown-menu">{this.props.children}</div>
            </div>
        );
    }
}

@observer
export class DropdownItem extends React.Component<
    {
        text: string;
        onClick: () => void;
        disabled?: boolean;
    },
    {}
> {
    @bind
    onClick(event: any) {
        event.preventDefault();
        event.stopPropagation();

        this.props.onClick();
    }

    render() {
        const { text } = this.props;

        let className = classNames("dropdown-item", {
            disabled: this.props.disabled
        });

        return (
            <a className={className} href="#" onClick={this.onClick}>
                {text}
            </a>
        );
    }
}
