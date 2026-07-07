import { html, LitElement, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { branding } from "../branding.js";
import "./OrbAnimation.js";

@customElement("brand-mascot")
export class BrandMascot extends LitElement {
	protected createRenderRoot(): HTMLElement | ShadowRoot {
		return this;
	}

	override render(): TemplateResult {
		const mascot = branding.mascot;

		if (mascot.type === "orb") {
			return html`<orb-animation></orb-animation>`;
		}

		if (mascot.type === "image") {
			return html`
				<img
					src=${mascot.src}
					alt=${mascot.alt}
					class="block h-[400px] w-[400px] max-w-[80vw] object-contain"
				/>
			`;
		}

		return html`
			<video
				src=${mascot.src}
				class="block h-[400px] w-[400px] max-w-[80vw] object-contain"
				autoplay
				loop
				muted
				playsinline
			></video>
		`;
	}
}
