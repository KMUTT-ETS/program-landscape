import { PdfGenerationError } from './errors';
import type { TemplateDefinition } from './types';

// A simple in-memory registry populated at module boot. NestJS's
// PdfModule registers @kku/pdf-templates' default registry here.
// Modules must not hold their own registries — there is one of these
// per process.
export class TemplateRegistry {
  private readonly templates = new Map<string, TemplateDefinition<unknown>>();

  register<T>(template: TemplateDefinition<T>): void {
    if (this.templates.has(template.name)) {
      throw new Error(
        `TemplateRegistry: template "${template.name}" already registered — names must be unique process-wide.`,
      );
    }
    this.templates.set(template.name, template as TemplateDefinition<unknown>);
  }

  get(name: string): TemplateDefinition<unknown> {
    const t = this.templates.get(name);
    if (!t) {
      throw new PdfGenerationError(
        'PDF_TEMPLATE_NOT_FOUND',
        `No PDF template registered under "${name}"`,
        { available: [...this.templates.keys()] },
      );
    }
    return t;
  }

  list(): Array<{ name: string; version: string }> {
    return [...this.templates.values()].map((t) => ({ name: t.name, version: t.version }));
  }
}
