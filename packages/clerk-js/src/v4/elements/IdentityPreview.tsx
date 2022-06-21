import React from 'react';

import { Button, Flex, Icon, Text } from '../customizables';
import { PencilEdit } from '../icons';
import { PropsOfComponent } from '../styledSystem';
import { stringToFormattedPhoneString } from '../utils';
import { Avatar } from './Avatar';

type IdentityPreviewProps = {
  avatarUrl: string | null | undefined;
  identifier: string | null | undefined;
  onClick: React.MouseEventHandler;
} & PropsOfComponent<typeof Flex>;

const formatIdentifier = (str: string | undefined | null) => {
  if (!str || str.includes('@') || str.match(/[a-zA-Z]/)) {
    return str;
  }
  return stringToFormattedPhoneString(str);
};

export const IdentityPreview = (props: IdentityPreviewProps) => {
  const { avatarUrl, identifier, onClick, ...rest } = props;
  const refs = React.useRef({ avatarUrl, identifier: formatIdentifier(identifier) });

  return (
    <Flex sx={theme => ({ marginTop: theme.space.$3x5 })}>
      <Flex
        align='center'
        gap={2}
        sx={theme => ({
          maxWidth: '100%',
          backgroundColor: theme.colors.$blackAlpha50,
          padding: `${theme.space.$2} ${theme.space.$4}`,
          borderRadius: theme.radii.$3xl,
          border: `${theme.borders.$normal} ${theme.colors.$blackAlpha200}`,
        })}
        {...rest}
      >
        <Avatar
          profileImageUrl={refs.current.avatarUrl}
          size={theme => theme.sizes.$5}
        />
        <Text
          variant='hint'
          colorScheme='neutral'
          truncate
        >
          {refs.current.identifier}
        </Text>
        <Button
          variant='ghostIcon'
          onClick={onClick}
        >
          <Icon icon={PencilEdit} />
        </Button>
      </Flex>
    </Flex>
  );
};
