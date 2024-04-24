import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { dateTime, dateTimeForTimeZone, getTimeZone, setTimeZoneResolver } from '@grafana/data';
import { Components } from '@grafana/e2e-selectors';

import { DateTimePicker, Props } from './DateTimePicker';

// An assortment of timezones that we will test the behavior of the DateTimePicker with different timezones
const TEST_TIMEZONES = ['browser', 'Europe/Stockholm', 'America/Indiana/Marengo'];

let defaultTimeZone = getTimeZone();
afterAll(() => {
  return setTimeZoneResolver(() => defaultTimeZone);
});

const renderDatetimePicker = (props?: Props) => {
  const combinedProps = Object.assign(
    {
      date: dateTimeForTimeZone(getTimeZone(), '2021-05-05 12:00:00'),
      onChange: () => {},
    },
    props
  );

  return render(<DateTimePicker {...combinedProps} />);
};

describe('Date time picker', () => {
  it('should render component', () => {
    renderDatetimePicker();

    expect(screen.queryByTestId('date-time-picker')).toBeInTheDocument();
  });

  it.each(TEST_TIMEZONES)('input should have a value (timezone: %s)', (timeZone) => {
    setTimeZoneResolver(() => timeZone);
    renderDatetimePicker();
    const dateTimeInput = screen.getByTestId(Components.DateTimePicker.input);
    expect(dateTimeInput).toHaveDisplayValue('2021-05-05 12:00:00');
  });

  it.each(TEST_TIMEZONES)('should render (timezone %s)', (timeZone) => {
    setTimeZoneResolver(() => timeZone);
    renderDatetimePicker();
    const dateTimeInput = screen.getByTestId(Components.DateTimePicker.input);
    expect(dateTimeInput).toHaveDisplayValue('2021-05-05 12:00:00');
  });

  it.each(TEST_TIMEZONES)('should update date onblur (timezone: %)', async (timeZone) => {
    setTimeZoneResolver(() => timeZone);
    const onChangeInput = jest.fn();
    render(<DateTimePicker date={dateTime('2021-05-05 12:00:00')} onChange={onChangeInput} />);
    const dateTimeInput = screen.getByTestId(Components.DateTimePicker.input);
    await userEvent.clear(dateTimeInput);
    await userEvent.type(dateTimeInput, '2021-07-31 12:30:30');
    expect(dateTimeInput).toHaveDisplayValue('2021-07-31 12:30:30');
    await userEvent.click(document.body);
    expect(onChangeInput).toHaveBeenCalled();
  });

  it.each(TEST_TIMEZONES)('should not update onblur if invalid date (timezone: %s)', async (timeZone) => {
    setTimeZoneResolver(() => timeZone);
    const onChangeInput = jest.fn();
    render(<DateTimePicker date={dateTime('2021-05-05 12:00:00')} onChange={onChangeInput} />);
    const dateTimeInput = screen.getByTestId(Components.DateTimePicker.input);
    await userEvent.clear(dateTimeInput);
    await userEvent.type(dateTimeInput, '2021:05:05 12-00-00');
    expect(dateTimeInput).toHaveDisplayValue('2021:05:05 12-00-00');
    await userEvent.click(document.body);
    expect(onChangeInput).not.toHaveBeenCalled();
  });

  it.each(TEST_TIMEZONES)(
    'should not change the day at times near the day boundary (timezone: %s)',
    async (timeZone) => {
      setTimeZoneResolver(() => timeZone);
      const onChangeInput = jest.fn();
      render(<DateTimePicker date={dateTime('2021-05-05 12:34:56')} onChange={onChangeInput} />);

      // Click the calendar button
      await userEvent.click(screen.getByRole('button', { name: 'Time picker' }));

      // Check the active day is the 5th
      expect(screen.getByRole('button', { name: 'May 5, 2021' })).toHaveClass('react-calendar__tile--active');

      // open the time of day overlay
      await userEvent.click(screen.getAllByRole('textbox')[1]);

      // change the hour
      await userEvent.click(
        screen.getAllByRole('button', {
          name: '00',
        })[0]
      );

      // Check the active day is the 5th
      expect(screen.getByRole('button', { name: 'May 5, 2021' })).toHaveClass('react-calendar__tile--active');

      // change the hour
      await userEvent.click(
        screen.getAllByRole('button', {
          name: '23',
        })[0]
      );

      // Check the active day is the 5th
      expect(screen.getByRole('button', { name: 'May 5, 2021' })).toHaveClass('react-calendar__tile--active');
    }
  );

  it.each(TEST_TIMEZONES)(
    'should not reset the time when selecting a different day (timezone: %s)',
    async (timeZone) => {
      setTimeZoneResolver(() => timeZone);
      const onChangeInput = jest.fn();
      render(<DateTimePicker date={dateTime('2021-05-05 12:34:56')} onChange={onChangeInput} />);

      // Click the calendar button
      await userEvent.click(screen.getByRole('button', { name: 'Time picker' }));

      // Select a different day in the calendar
      await userEvent.click(screen.getByRole('button', { name: 'May 15, 2021' }));

      const timeInput = screen.getAllByRole('textbox')[1];
      expect(timeInput).toHaveClass('rc-time-picker-input');
      expect(timeInput).not.toHaveDisplayValue('00:00:00');
    }
  );

  it.each(TEST_TIMEZONES)('should not alter a UTC time when blurring (timezone: %s)', async (timeZone) => {
    setTimeZoneResolver(() => timeZone);
    const onChangeInput = jest.fn();

    // render with a UTC value
    const { rerender } = render(
      <DateTimePicker date={dateTime('2024-04-16T08:44:41.000000Z')} onChange={onChangeInput} />
    );

    const inputValue = screen.getByTestId(Components.DateTimePicker.input).getAttribute('value')!;

    // blur the input to trigger an onChange
    await userEvent.click(screen.getByTestId(Components.DateTimePicker.input));
    await userEvent.click(document.body);

    const onChangeValue = onChangeInput.mock.calls[0][0];
    expect(onChangeInput).toHaveBeenCalledWith(onChangeValue);

    // now rerender with the "changed" value
    rerender(<DateTimePicker date={onChangeValue} onChange={onChangeInput} />);

    // expect the input to show the same value
    expect(screen.getByTestId(Components.DateTimePicker.input)).toHaveDisplayValue(inputValue);

    // blur the input to trigger an onChange
    await userEvent.click(screen.getByTestId(Components.DateTimePicker.input));
    await userEvent.click(document.body);

    // expect the onChange to be called with the same value
    expect(onChangeInput).toHaveBeenCalledWith(onChangeValue);
  });

  it.each(TEST_TIMEZONES)(
    'should be able to select values in TimeOfDayPicker without blurring the element (timezone: %s)',
    async (timeZone) => {
      setTimeZoneResolver(() => timeZone);
      renderDatetimePicker();

      // open the calendar + time picker
      await userEvent.click(screen.getByLabelText('Time picker'));

      // open the time of day overlay
      await userEvent.click(screen.getAllByRole('textbox')[1]);

      // check the hour element is visible
      const hourElement = screen.getAllByRole('button', {
        name: '00',
      })[0];
      expect(hourElement).toBeVisible();

      // select the hour value and check it's still visible
      await userEvent.click(hourElement);
      expect(hourElement).toBeVisible();

      // click outside the overlay and check the hour element is no longer visible
      await userEvent.click(document.body);
      expect(
        screen.queryByRole('button', {
          name: '00',
        })
      ).not.toBeInTheDocument();
    }
  );
});
