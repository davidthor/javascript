import type { FormControlProps, FormFieldProps, FormMessageProps, FormProps } from '@radix-ui/react-form';
import { Control, Field as RadixField, Form as RadixForm, Label, Message, Submit } from '@radix-ui/react-form';
import { Slot } from '@radix-ui/react-slot';

import { useField, useFieldError, useForm, useInput } from '../internals/machines/sign-in.context';

function Input({ asChild, ...rest }: FormControlProps) {
  const { type, value } = rest;
  const field = useInput({ type, value });

  const Comp = asChild ? Slot : Control;

  return (
    <Comp
      {...field.props}
      {...rest}
    />
  );
}

function Form({ asChild, ...rest }: FormProps) {
  const form = useForm();
  const Comp = asChild ? Slot : RadixForm;

  return (
    <Comp
      {...form.props}
      {...rest}
    />
  );
}

function Field({ asChild, ...rest }: FormFieldProps) {
  const field = useField({ type: rest.name });
  const Comp = asChild ? Slot : RadixField;

  return (
    <Comp
      {...field.props}
      {...rest}
    />
  );
}

interface FormErrorProps extends Omit<FormMessageProps, 'match'> {
  match: string; // TODO: Type with the possible matches
}

function Error({ asChild, ...rest }: FormErrorProps) {
  const msg = useFieldError({ type: rest.name });
  const Comp = asChild ? Slot : (Message as React.ExoticComponent<FormErrorProps>);

  return (
    <Comp
      forceMatch={msg.shouldForceMatch(rest.match)}
      {...rest}
    />
  );
}

export { Error, Field, Form, Input, Label, Message, Submit };
